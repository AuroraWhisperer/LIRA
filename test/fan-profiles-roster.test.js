'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, deferred, SCOPE_A } = require('./helpers/fan-profile-controller-fixture');

test('daily roster waits until 12:10 Shanghai time and delivers one scheduled notification', async (t) => {
  let now = Date.parse('2026-09-20T12:09:55+08:00');
  const f = fixture(t, { now: () => now, state: { windowOpen: true }, autoSyncGuardRoster: true });
  await f.controller.start();
  assert.equal(f.calls.roster.length, 0);
  const timer = [...f.timers.pending.values()].find((entry) => entry.delay === 5000);
  assert.ok(timer, 'main-process timer targets 12:10 even while the fan page is hidden');
  now += 5000;
  f.timers.pending.delete(timer);
  timer.callback();
  await f.controller.whenIdle();
  assert.equal(f.calls.imports.length, 1);
  const notice = await f.invoke({ action: 'auto-update-status' });
  assert.equal(notice.data.reason, 'scheduled');
  assert.equal(notice.data.status, 'success');
  assert.equal((await f.invoke({ action: 'auto-update-status' })).data, null);
  assert.equal(f.calls.roster.length, 1);
  now = Date.parse('2026-09-21T12:10:00+08:00');
  assert.equal((await f.invoke({ action: 'auto-update-status' })).data.reason, 'scheduled');
  assert.equal(f.calls.roster.length, 2);
  f.controller.dispose();
  assert.equal(f.timers.pending.size, 0);
});

test('first launch after 12:10 catches up once and a restart preserves the daily success marker', async (t) => {
  const options = {
    now: () => Date.parse('2026-09-20T14:00:00+08:00'),
    state: { windowOpen: true },
    autoSyncGuardRoster: true,
    settings: new Map(),
  };
  const f = fixture(t, options);
  const notice = await f.invoke({ action: 'auto-update-status' });
  assert.equal(notice.data.reason, 'startup');
  assert.equal(notice.data.status, 'success');
  f.controller.dispose();
  const reopened = fixture(t, options);
  assert.equal((await reopened.invoke({ action: 'auto-update-status' })).data, null);
  assert.equal(reopened.calls.roster.length, 0);
});

test('automatic roster requires its opt-in setting, an open window and a configured room', async (t) => {
  for (const options of [
    { state: { windowOpen: true } },
    { autoSyncGuardRoster: true },
    { autoSyncGuardRoster: true, state: { windowOpen: true, roomId: '' } },
  ]) {
    const f = fixture(t, { now: () => Date.parse('2026-09-20T14:00:00+08:00'), ...options });
    assert.equal((await f.invoke({ action: 'auto-update-status' })).data, null);
    assert.equal(f.calls.roster.length, 0);
  }
});

test('automatic roster is independent of unavailable remote facts and does not spam failed retries', async (t) => {
  const f = fixture(t, {
    now: () => Date.parse('2026-09-20T14:00:00+08:00'),
    state: { windowOpen: true },
    autoSyncGuardRoster: true,
    fetch: () => {
      throw new Error('offline');
    },
    roster: () => {
      throw new Error('raw transport secret');
    },
  });
  await f.controller.start();
  const notice = await f.invoke({ action: 'auto-update-status' });
  assert.equal(notice.data.reason, 'startup');
  assert.equal(notice.data.status, 'error');
  assert.doesNotMatch(notice.data.error, /raw transport secret/);
  assert.equal(f.settings.get(SCOPE_A)?.lastGuardRosterAutoUpdate, undefined);
  assert.equal((await f.invoke({ action: 'auto-update-status' })).data, null);
  assert.equal(f.calls.roster.length, 1);
  const reopened = fixture(t, {
    now: () => Date.parse('2026-09-20T15:00:00+08:00'),
    state: { windowOpen: true },
    autoSyncGuardRoster: true,
    settings: f.settings,
  });
  assert.equal((await reopened.invoke({ action: 'auto-update-status' })).data.status, 'success');
});

test('automatic roster shares manual import exclusion and cancels on shutdown or account changes', async (t) => {
  for (const change of ['dispose', 'account', 'room', 'disable']) {
    const pending = deferred();
    const f = fixture(t, {
      now: () => Date.parse('2026-09-20T14:00:00+08:00'),
      state: { windowOpen: true },
      autoSyncGuardRoster: true,
      roster: () => pending.promise,
    });
    const automatic = f.invoke({ action: 'auto-update-status' });
    const opened = f.invoke({ action: 'open' });
    assert.match(f.invoke({ action: 'sync-guard-roster', contextId: opened.contextId }).error, /正在同步/);
    if (change === 'dispose') f.controller.dispose();
    if (change === 'account') {
      f.state.streamerId = 'streamer-b';
      f.emit();
    }
    if (change === 'room') f.state.roomId = '99';
    if (change === 'disable')
      f.invoke({
        action: 'configure',
        contextId: opened.contextId,
        payload: { autoCreate: true, autoUpdate: true, autoSyncGuardRoster: false },
      });
    pending.resolve({ roomId: '42', members: [] });
    assert.equal((await automatic).data, null);
    await f.controller.whenIdle();
    assert.equal(f.calls.imports.length, 0);
    assert.equal(f.settings.get(SCOPE_A)?.lastGuardRosterAutoUpdate, undefined);
  }
});

test('renewal cancels the old automatic import and allows the current authorization to complete it', async (t) => {
  const pending = deferred();
  let reads = 0;
  const f = fixture(t, {
    now: () => Date.parse('2026-09-20T14:00:00+08:00'),
    state: { windowOpen: true },
    autoSyncGuardRoster: true,
    roster: () => (++reads === 1 ? pending.promise : { roomId: '42', members: [] }),
  });
  const automatic = f.invoke({ action: 'auto-update-status' });
  f.state.epoch++;
  f.emit();
  assert.equal(f.calls.roster[0].signal.aborted, true);
  pending.resolve({ roomId: '42', members: [] });
  assert.equal((await automatic).data, null);
  assert.equal(f.calls.imports.length, 0);
  assert.equal((await f.invoke({ action: 'auto-update-status' })).data.status, 'success');
  assert.equal(f.calls.imports.length, 1);
});

test('manual roster IPC uses configured room and authenticated scope, ignoring supplied owner or members', async (t) => {
  const f = fixture(t);
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.roomId, '42');
  const result = await f.invoke({
    action: 'sync-guard-roster',
    contextId: opened.contextId,
    payload: { roomId: 'evil', streamerId: 'streamer-b', members: ['untrusted'] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.created, 1);
  assert.equal(f.calls.roster[0].roomId, '42');
  assert.equal(f.calls.imports[0].scope, SCOPE_A);
  assert.deepEqual(f.calls.imports[0].snapshot.members, []);
  assert.equal(f.calls.fetch.length, 0);
});

test('manual roster IPC rejects a changed room before starting a request', (t) => {
  const f = fixture(t);
  const opened = f.invoke({ action: 'open' });
  f.state.roomId = '77';
  const result = f.invoke({
    action: 'sync-guard-roster',
    contextId: opened.contextId,
    payload: { expectedRoomId: opened.roomId },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /直播间已变化/);
  assert.equal(f.calls.roster.length, 0);
});

test('manual roster IPC prevents overlap and late writes after room/account changes or disposal', async (t) => {
  for (const change of [
    (f) => {
      f.state.roomId = '77';
    },
    (f) => {
      f.state.streamerId = 'streamer-b';
      f.emit();
    },
    (f) => {
      f.state.epoch++;
    },
    (f) => {
      f.state.authorized = false;
    },
    (f) => {
      f.controller.dispose();
    },
  ]) {
    const pending = deferred();
    const f = fixture(t, { roster: () => pending.promise });
    const contextId = f.invoke({ action: 'open' }).contextId;
    const first = f.invoke({ action: 'sync-guard-roster', contextId });
    assert.match((await f.invoke({ action: 'sync-guard-roster', contextId })).error, /正在同步/);
    change(f);
    pending.resolve({ roomId: '1234', members: [] });
    assert.equal((await first).ok, false);
    assert.equal(f.calls.imports.length, 0);
    await f.controller.whenIdle();
  }
});

test('manual roster IPC reports failures without exposing raw transport details and permits retry', async (t) => {
  let fail = true;
  const f = fixture(t, {
    roster: () => {
      if (fail) throw new Error('fetch failed token=fictional-secret');
      return { members: [] };
    },
  });
  const contextId = f.invoke({ action: 'open' }).contextId;
  const failed = await f.invoke({ action: 'sync-guard-roster', contextId });
  assert.equal(failed.ok, false);
  assert.doesNotMatch(failed.error, /fictional-secret/);
  assert.equal(f.calls.imports.length, 0);
  fail = false;
  assert.equal((await f.invoke({ action: 'sync-guard-roster', contextId })).ok, true);
});

test('shutdown drains an in-flight manual roster request after abort before closing storage', async (t) => {
  const pending = deferred();
  const f = fixture(t, { roster: () => pending.promise });
  const contextId = f.invoke({ action: 'open' }).contextId;
  const request = f.invoke({ action: 'sync-guard-roster', contextId });
  assert.equal((await f.invoke({ action: 'sync-guard-roster', contextId })).ok, false);
  f.controller.dispose();
  assert.equal(f.calls.roster[0].signal.aborted, true);
  let drained = false;
  const idle = f.controller.whenIdle().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  pending.resolve({ members: [] });
  await idle;
  assert.equal((await request).ok, false);
  assert.equal(f.calls.imports.length, 0);
});
