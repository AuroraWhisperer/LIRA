'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFanProfileController, fanScopeFor } = require('../src/electron/fan-profile-controller');
const { registerFanProfileIpc } = require('../src/electron/ipc/fan-profile-ipc');

const ORIGIN = 'http://127.0.0.1:3000';
const SCOPE_A = JSON.stringify(['https://lira.example', 'streamer-a']);
const SCOPE_B = JSON.stringify(['https://lira.example', 'streamer-b']);

class FakeTimers {
  pending = new Map();

  setTimeout(callback, delay) {
    const handle = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true; } };
    this.pending.set(handle, handle);
    return handle;
  }

  clearTimeout(handle) { this.pending.delete(handle); }

  runNext() {
    const handle = this.pending.values().next().value;
    assert.ok(handle, 'expected a scheduled retry');
    this.pending.delete(handle);
    handle.callback();
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fixture(t, options = {}) {
  const state = { authorized: true, streamerId: 'streamer-a', accountName: '虚构账号甲',
    epoch: 1, origin: 'https://lira.example', roomId: '42', ...options.state };
  const calls = { execute: [], consume: [], fetch: [], roster: [], imports: [], unsubscribe: 0 };
  const settings = options.settings || new Map();
  const listeners = new Set();
  const timers = new FakeTimers();
  const getSettings = (scope) => settings.get(scope) || { initialized: options.initialized !== false, cursor: 0, epoch: null,
    autoSyncGuardRoster: options.autoSyncGuardRoster === true };
  const page = (streamerId = state.streamerId, nextCursor = 1) => ({ version: 1, streamerId,
    epoch: 'remote-epoch', after: 0, nextCursor, events: [], hasMore: false });
  const licenseManager = {
    isAuthorized: () => state.authorized,
    getCloudSyncIdentity: () => ({ streamerId: state.streamerId, accountName: state.accountName }),
    getRemoteBaseUrl: () => state.origin,
    getAuthorizationEpoch: () => state.epoch,
    onStateChanged(listener) {
      listeners.add(listener);
      return () => { calls.unsubscribe++; listeners.delete(listener); };
    },
    async getFanFactsInternal(input) {
      calls.fetch.push({ scope: fanScopeFor(licenseManager), ...input });
      return options.fetch ? options.fetch(input, state) : page();
    },
  };
  const service = {
    importGuardRoster(scope, snapshot, automaticDate) {
      calls.imports.push({ scope, snapshot });
      if (automaticDate) settings.set(scope, { ...getSettings(scope),
        lastGuardRosterAutoUpdate: { date: automaticDate, roomId: state.roomId } });
      return { created: 1, updated: 0, skipped: 0, total: 1 };
    },
    execute(scope, action, payload) {
      calls.execute.push({ scope, action, payload });
      if (action === 'settings') return getSettings(scope);
      if (action === 'configure') {
        const next = { ...getSettings(scope), ...payload, initialized: true };
        settings.set(scope, next);
        return next;
      }
      if (action === 'list') return { profiles: [{ id: 'fictional-profile', alias: '小海' }] };
      return { saved: true };
    },
    consumeFacts(scope, value) {
      calls.consume.push({ scope, page: value });
      const next = { ...getSettings(scope), cursor: value.nextCursor, epoch: value.epoch };
      settings.set(scope, next);
      return next;
    },
  };
  const controller = createFanProfileController({ licenseManager, getService: () => service, timers,
    now: options.now,
    isWindowOpen: () => state.windowOpen === true,
    getRoomId: () => state.roomId,
    fetchGuardRoster: async (roomId, input) => {
      calls.roster.push({ roomId, ...input });
      return options.roster ? options.roster(input) : { roomId: '1234', members: [] };
    },
  });
  const handlers = new Map();
  const frame = { url: `${ORIGIN}/admin?desktop=1` };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  let mainWindow = window;
  const disposeIpc = registerFanProfileIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) },
    controller, getMainWindow: () => mainWindow, getDesktopBaseUrl: () => ORIGIN,
  });
  const event = { sender: window.webContents, senderFrame: frame };
  const invoke = (request, sender = event) => handlers.get('fan-profiles:invoke')(sender, request);
  t.after(() => { disposeIpc(); controller.dispose(); });
  return { state, calls, settings, timers, page, licenseManager, service, controller, handlers, frame, window,
    event, invoke, disposeIpc, setWindow: (value) => { mainWindow = value; }, listeners,
    emit: () => { for (const listener of listeners) listener(); } };
}

test('fan scope uses authenticated origin and stable streamer identity only', (t) => {
  const f = fixture(t);
  f.state.origin = 'https://lira.example/configurable/base';
  assert.equal(fanScopeFor(f.licenseManager), SCOPE_A);
  f.state.authorized = false;
  assert.equal(fanScopeFor(f.licenseManager), null);
  f.state.authorized = true;
  f.state.streamerId = null;
  assert.equal(fanScopeFor(f.licenseManager), null);
  f.state.streamerId = 'streamer-a';
  f.state.origin = '';
  assert.equal(fanScopeFor(f.licenseManager), null);
});

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
  const options = { now: () => Date.parse('2026-09-20T14:00:00+08:00'),
    state: { windowOpen: true }, autoSyncGuardRoster: true, settings: new Map() };
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
  const f = fixture(t, { now: () => Date.parse('2026-09-20T14:00:00+08:00'),
    state: { windowOpen: true }, autoSyncGuardRoster: true,
    fetch: () => { throw new Error('offline'); },
    roster: () => { throw new Error('raw transport secret'); } });
  await f.controller.start();
  const notice = await f.invoke({ action: 'auto-update-status' });
  assert.equal(notice.data.reason, 'startup');
  assert.equal(notice.data.status, 'error');
  assert.doesNotMatch(notice.data.error, /raw transport secret/);
  assert.equal(f.settings.get(SCOPE_A)?.lastGuardRosterAutoUpdate, undefined);
  assert.equal((await f.invoke({ action: 'auto-update-status' })).data, null);
  assert.equal(f.calls.roster.length, 1);
  const reopened = fixture(t, { now: () => Date.parse('2026-09-20T15:00:00+08:00'),
    state: { windowOpen: true }, autoSyncGuardRoster: true, settings: f.settings });
  assert.equal((await reopened.invoke({ action: 'auto-update-status' })).data.status, 'success');
});

test('automatic roster shares manual import exclusion and cancels on shutdown or account changes', async (t) => {
  for (const change of ['dispose', 'account', 'room', 'disable']) {
    const pending = deferred();
    const f = fixture(t, { now: () => Date.parse('2026-09-20T14:00:00+08:00'),
      state: { windowOpen: true }, autoSyncGuardRoster: true, roster: () => pending.promise });
    const automatic = f.invoke({ action: 'auto-update-status' });
    const opened = f.invoke({ action: 'open' });
    assert.match(f.invoke({ action: 'sync-guard-roster', contextId: opened.contextId }).error, /正在同步/);
    if (change === 'dispose') f.controller.dispose();
    if (change === 'account') { f.state.streamerId = 'streamer-b'; f.emit(); }
    if (change === 'room') f.state.roomId = '99';
    if (change === 'disable') f.invoke({ action: 'configure', contextId: opened.contextId,
      payload: { autoCreate: true, autoUpdate: true, autoSyncGuardRoster: false } });
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
  const f = fixture(t, { now: () => Date.parse('2026-09-20T14:00:00+08:00'),
    state: { windowOpen: true }, autoSyncGuardRoster: true,
    roster: () => ++reads === 1 ? pending.promise : { roomId: '42', members: [] } });
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

test('fan IPC admits only the actual main frame at the exact desktop origin and allowed admin paths', (t) => {
  const f = fixture(t);
  for (const pathname of ['/', '/admin', '/settings', '/songs']) {
    f.frame.url = `${ORIGIN}${pathname}?desktop=1#fan-profiles`;
    const result = f.invoke({ action: 'open' });
    assert.equal(result.ok, true);
    assert.ok(result.contextId);
    assert.equal(result.data.profiles[0].alias, '小海');
  }
  assert.equal(f.calls.execute.length, 4);
  assert.equal(f.calls.execute.every((call) => call.scope === SCOPE_A && call.action === 'list'), true);
});

test('fan IPC rejects iframes, other windows and missing or destroyed main windows before reading data', (t) => {
  const f = fixture(t);
  for (const event of [{}, { ...f.event, sender: {} }, { ...f.event, senderFrame: { url: f.frame.url } }]) {
    assert.deepEqual(f.invoke({ action: 'open' }, event), { ok: false, error: 'IPC_SOURCE_INVALID' });
  }
  f.window.isDestroyed = () => true;
  assert.equal(f.invoke({ action: 'open' }).error, 'IPC_SOURCE_INVALID');
  f.setWindow(null);
  assert.equal(f.invoke({ action: 'open' }).error, 'IPC_SOURCE_INVALID');
  assert.equal(f.calls.execute.length, 0);
});

test('fan IPC rejects overlays, origin lookalikes, other ports and non-admin navigation', (t) => {
  const f = fixture(t);
  for (const url of [
    `${ORIGIN}/song-board`, `${ORIGIN}/overlay`, `${ORIGIN}/admin/extra`,
    `${ORIGIN}/public/pages/admin/index.html`, 'http://127.0.0.1:3001/admin',
    'http://localhost:3000/admin', 'https://127.0.0.1:3000/admin',
    'http://127.0.0.1.attacker.example:3000/admin', 'https://lira.example/admin',
    'file:///admin', 'not-a-url',
  ]) {
    f.frame.url = url;
    assert.deepEqual(f.invoke({ action: 'open' }), { ok: false, error: 'IPC_SOURCE_INVALID' }, url);
  }
  assert.equal(f.calls.execute.length, 0);
});

test('fan IPC rejects unauthenticated access and old contexts after streamer or origin changes', async (t) => {
  const f = fixture(t);
  let opened = f.invoke({ action: 'open' });
  f.state.authorized = false;
  assert.match(f.invoke({ action: 'list', contextId: opened.contextId }).error, /先登录/);
  assert.equal(f.calls.execute.length, 1);
  f.emit();
  await f.controller.whenIdle();
  assert.equal(f.calls.fetch.length, 0);
  f.state.authorized = true;
  f.state.streamerId = 'streamer-b';
  f.state.epoch++;
  assert.match(f.invoke({ action: 'save', contextId: opened.contextId, payload: { notes: '不得串档' } }).error, /登录状态已变化/);
  opened = f.invoke({ action: 'open' });
  assert.equal(f.calls.execute.at(-1).scope, SCOPE_B);
  f.state.origin = 'https://other.example';
  assert.match(f.invoke({ action: 'save', contextId: opened.contextId }).error, /登录状态已变化/);
  assert.equal(f.calls.execute.some((call) => call.action === 'save'), false);
});

test('same-account renewal keeps the profile context and permits saving an already open editor', async (t) => {
  for (const notify of [false, true]) {
    const f = fixture(t, { initialized: false });
    const opened = f.invoke({ action: 'open' });
    f.state.epoch++;
    if (notify) f.emit();
    const saved = f.invoke({ action: 'save', contextId: opened.contextId,
      payload: { id: 'fictional-profile', notes: '续期前已经输入的备注' } });
    assert.equal(saved.ok, true);
    assert.equal(saved.contextId, opened.contextId);
    assert.equal(f.calls.execute.at(-1).scope, SCOPE_A);
    assert.equal(f.calls.execute.at(-1).payload.notes, '续期前已经输入的备注');
    assert.equal(f.invoke({ action: 'open' }).contextId, opened.contextId);
    await f.controller.whenIdle();
  }
});

test('an unchanged authorization notification preserves the context and an in-flight roster read', async (t) => {
  const pending = deferred();
  const f = fixture(t, { initialized: false, roster: () => pending.promise });
  const opened = f.invoke({ action: 'open' });
  const request = f.invoke({ action: 'sync-guard-roster', contextId: opened.contextId });
  f.emit();
  const aborted = f.calls.roster[0].signal.aborted;
  pending.resolve({ roomId: '42', members: [] });
  const result = await request;
  await f.controller.whenIdle();
  assert.equal(aborted, false);
  assert.equal(result.ok, true);
  assert.equal(f.calls.imports.length, 1);
  assert.equal(f.invoke({ action: 'open' }).contextId, opened.contextId);
});

test('losing authorization invalidates the old context even when the same account logs back in', async (t) => {
  for (const notify of [false, true]) {
    const f = fixture(t, { initialized: false });
    const opened = f.invoke({ action: 'open' });
    f.state.authorized = false;
    if (notify) f.emit();
    else assert.match(f.invoke({ action: 'list', contextId: opened.contextId }).error, /先登录/);
    f.state.authorized = true;
    f.state.epoch++;
    const saved = f.invoke({ action: 'save', contextId: opened.contextId });
    assert.equal(saved.ok, false);
    assert.match(saved.error, /登录状态已变化/);
    assert.equal(f.calls.execute.some((call) => call.action === 'save'), false);
    assert.notEqual(f.invoke({ action: 'open' }).contextId, opened.contextId);
    await f.controller.whenIdle();
  }
});

test('switching back to a previous streamer or server never revives its old context', (t) => {
  for (const [key, value] of [['streamerId', 'streamer-b'], ['origin', 'https://other.example']]) {
    const f = fixture(t);
    const originalValue = f.state[key];
    const opened = f.invoke({ action: 'open' });
    f.state[key] = value;
    assert.notEqual(f.invoke({ action: 'open' }).contextId, opened.contextId);
    f.state[key] = originalValue;
    assert.equal(f.invoke({ action: 'save', contextId: opened.contextId }).ok, false);
    assert.equal(f.calls.execute.some((call) => call.action === 'save'), false);
    assert.notEqual(f.invoke({ action: 'open' }).contextId, opened.contextId);
  }
});

test('fan IPC uses main-process scope despite renderer-supplied owner fields and redacts raw storage errors', (t) => {
  const f = fixture(t);
  const opened = f.invoke({ action: 'open' });
  assert.equal(f.invoke({ action: 'save', contextId: opened.contextId, scope: SCOPE_B,
    payload: { scope: SCOPE_B, streamerId: 'streamer-b' } }).ok, true);
  assert.equal(f.calls.execute.at(-1).scope, SCOPE_A);
  f.service.execute = () => { throw new Error('SQLITE_ERROR token=fictional-secret'); };
  const failed = f.invoke({ action: 'save', contextId: opened.contextId });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.includes('fictional-secret'), false);
  assert.match(failed.error, /尚未保存/);
});

test('late remote responses cannot write after a streamer switch, even when transport ignores abort', async (t) => {
  const delayed = deferred();
  let first = true;
  const f = fixture(t, { fetch: (input, state) => {
    if (first) { first = false; return delayed.promise; }
    return { version: 1, streamerId: state.streamerId, epoch: 'new-epoch', nextCursor: 2, events: [], hasMore: false };
  } });
  const oldContext = f.invoke({ action: 'open' }).contextId;
  const oldOperation = f.controller.start();
  await Promise.resolve();
  assert.equal(f.calls.fetch.length, 1);
  const oldSignal = f.calls.fetch[0].signal;
  f.state.streamerId = 'streamer-b';
  f.state.epoch++;
  f.emit();
  assert.equal(oldSignal.aborted, true);
  assert.match(f.invoke({ action: 'list', contextId: oldContext }).error, /登录状态已变化/);
  delayed.resolve(f.page('streamer-a'));
  await oldOperation;
  await f.controller.whenIdle();
  assert.deepEqual(f.calls.consume.map((call) => call.scope), [SCOPE_B]);
  assert.equal(f.calls.consume[0].page.streamerId, 'streamer-b');
});

test('late remote responses are rejected when origin or authorization changes without a state event', async (t) => {
  for (const change of [
    (state) => { state.origin = 'https://other.example'; },
    (state) => { state.authorized = false; },
    (state) => { state.epoch++; },
  ]) {
    const delayed = deferred();
    const f = fixture(t, { fetch: () => delayed.promise });
    const operation = f.controller.start();
    await Promise.resolve();
    change(f.state);
    delayed.resolve(f.page());
    await operation;
    assert.equal(f.calls.consume.length, 0);
    f.controller.dispose();
  }
});

test('dispose aborts in-flight work, clears retries, removes listeners and prevents late writes', async (t) => {
  const delayed = deferred();
  const f = fixture(t, { fetch: () => delayed.promise });
  const operation = f.controller.start();
  await Promise.resolve();
  const signal = f.calls.fetch[0].signal;
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(f.calls.unsubscribe, 1);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.pending.size, 0);
  delayed.resolve(f.page());
  await operation;
  assert.equal(f.calls.consume.length, 0);
  assert.equal(f.timers.pending.size, 0);
  assert.match(f.invoke({ action: 'open' }).error, /先登录/);
  f.disposeIpc();
  f.disposeIpc();
  assert.equal(f.handlers.size, 0);
});

test('legacy server 404 disables automatic facts gracefully while manual profile actions keep working', async (t) => {
  const f = fixture(t, { fetch: () => { throw Object.assign(new Error('not found'), { status: 404 }); } });
  await f.controller.start();
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.ok, true);
  assert.equal(opened.syncStatus, 'unsupported');
  assert.equal(opened.data.profiles.length, 1);
  const saved = f.invoke({ action: 'save', contextId: opened.contextId, payload: { alias: '手动资料' } });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.saved, true);
  assert.equal(f.calls.consume.length, 0);
  assert.equal(f.timers.pending.size, 1);
  const retry = f.timers.pending.values().next().value;
  assert.ok(retry.delay >= 15000);
  assert.equal(retry.unrefCalled, true);
  f.controller.dispose();
  assert.equal(f.timers.pending.size, 0);
});

test('first-use settings gate remote facts until configuration and committed cursors drive later pages', async (t) => {
  const f = fixture(t, { initialized: false, fetch: (input, state) => ({ version: 1,
    streamerId: state.streamerId, epoch: 'remote-epoch', nextCursor: input.after + 1, events: [],
    hasMore: input.after < 1 }) });
  await f.controller.start();
  assert.equal(f.calls.fetch.length, 0);
  const opened = f.invoke({ action: 'open' });
  f.invoke({ action: 'configure', contextId: opened.contextId, payload: { autoCreate: true, autoUpdate: true } });
  await f.controller.whenIdle();
  assert.deepEqual(f.calls.fetch.map((call) => call.after), [0, 1]);
  assert.deepEqual(f.calls.consume.map((call) => call.page.nextCursor), [1, 2]);
  assert.equal(f.timers.pending.size, 1);
  f.timers.runNext();
  await f.controller.whenIdle();
  assert.equal(f.calls.fetch.at(-1).after, 2);
});

test('a temporary settings read failure schedules a retry and cannot poison later synchronization', async (t) => {
  const f = fixture(t);
  const execute = f.service.execute;
  let failOnce = true;
  f.service.execute = (scope, action, payload) => {
    if (action === 'settings' && failOnce) {
      failOnce = false;
      throw new Error('fictional temporary storage failure');
    }
    return execute(scope, action, payload);
  };
  await assert.doesNotReject(f.controller.start());
  assert.equal(f.calls.fetch.length, 0);
  assert.equal(f.calls.consume.length, 0);
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.ok, true);
  assert.equal(opened.syncStatus, 'offline');
  assert.equal(f.timers.pending.size, 1);
  assert.equal(f.timers.pending.values().next().value.delay, 30000);
  f.timers.runNext();
  await assert.doesNotReject(f.controller.whenIdle());
  assert.equal(f.calls.fetch.length, 1);
  assert.equal(f.calls.fetch[0].after, 0);
  assert.deepEqual(f.calls.consume.map(({ scope }) => scope), [SCOPE_A]);
  assert.equal(f.invoke({ action: 'list', contextId: opened.contextId }).syncStatus, 'ready');
  assert.equal(f.timers.pending.size, 1);
  assert.equal(f.timers.pending.values().next().value.delay, 15000);
});

test('a bounded ten-page pass remains syncing and the scheduled continuation resumes the committed cursor', async (t) => {
  const f = fixture(t, { fetch: (input, state) => ({ version: 1, streamerId: state.streamerId,
    epoch: 'remote-epoch', after: input.after, nextCursor: input.after + 1, events: [],
    hasMore: input.after < 10 }) });
  await f.controller.start();
  assert.deepEqual(f.calls.fetch.map(({ after }) => after), Array.from({ length: 10 }, (_, index) => index));
  assert.equal(f.calls.consume.length, 10);
  assert.equal(f.invoke({ action: 'open' }).syncStatus, 'syncing');
  assert.equal(f.settings.get(SCOPE_A).cursor, 10);
  assert.equal(f.timers.pending.size, 1);
  f.timers.runNext();
  await f.controller.whenIdle();
  assert.equal(f.calls.fetch.length, 11);
  assert.equal(f.calls.fetch.at(-1).after, 10);
  assert.equal(f.calls.consume.at(-1).page.nextCursor, 11);
  assert.equal(f.invoke({ action: 'open' }).syncStatus, 'ready');
});

test('manual roster IPC uses configured room and authenticated scope, ignoring supplied owner or members', async (t) => {
  const f = fixture(t);
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.roomId, '42');
  const result = await f.invoke({ action: 'sync-guard-roster', contextId: opened.contextId,
    payload: { roomId: 'evil', streamerId: 'streamer-b', members: ['untrusted'] } });
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
  const result = f.invoke({ action: 'sync-guard-roster', contextId: opened.contextId,
    payload: { expectedRoomId: opened.roomId } });
  assert.equal(result.ok, false);
  assert.match(result.error, /直播间已变化/);
  assert.equal(f.calls.roster.length, 0);
});

test('manual roster IPC prevents overlap and late writes after room/account changes or disposal', async (t) => {
  for (const change of [
    (f) => { f.state.roomId = '77'; },
    (f) => { f.state.streamerId = 'streamer-b'; f.emit(); },
    (f) => { f.state.epoch++; },
    (f) => { f.state.authorized = false; },
    (f) => { f.controller.dispose(); },
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
  const f = fixture(t, { roster: () => {
    if (fail) throw new Error('fetch failed token=fictional-secret');
    return { members: [] };
  } });
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
  const idle = f.controller.whenIdle().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  pending.resolve({ members: [] });
  await idle;
  assert.equal((await request).ok, false);
  assert.equal(f.calls.imports.length, 0);
});
