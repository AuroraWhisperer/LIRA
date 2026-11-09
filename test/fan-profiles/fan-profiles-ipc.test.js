'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanScopeFor } = require('../../src/electron/fan-profile-controller');
const { fixture, deferred, SCOPE_A, SCOPE_B } = require('../helpers/fan-profile-controller-fixture');

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

test('read-only fan calendar uses the authenticated scope without accepting a caller scope', (t) => {
  const f = fixture(t);
  assert.equal(f.invoke({ action: 'calendar', payload: { scope: SCOPE_B } }).ok, true);
  assert.equal(f.calls.execute.at(-1).scope, SCOPE_A);
  assert.equal(f.calls.execute.at(-1).action, 'calendar');
  f.state.authorized = false;
  assert.match(f.invoke({ action: 'calendar' }).error, /先登录/);
  f.state.authorized = true;
  f.state.streamerId = 'streamer-b';
  f.state.epoch++;
  assert.equal(f.invoke({ action: 'calendar' }).ok, true);
  assert.equal(f.calls.execute.at(-1).scope, SCOPE_B);
});

test('fan IPC applies the shared source policy before reading profiles', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.invoke({ action: 'open' }, {}), { ok: false, error: 'IPC_SOURCE_INVALID' });
  assert.equal(f.calls.execute.length, 0);
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.ok, true);
  assert.ok(opened.contextId);
  assert.equal(f.calls.execute.at(-1).scope, SCOPE_A);
  assert.equal(f.calls.execute.at(-1).action, 'list');
});

test('identity preview validates UID and projects public profile fields without writing a fan', async (t) => {
  const f = fixture(t, { profile: async () => ({
    name: '预览昵称', avatarUrl: 'https://i0.hdslb.com/bfs/face/preview.jpg', cookieHeader: 'private',
  }) });
  const { contextId } = f.invoke({ action: 'open' });
  const request = (uid) => f.invoke({ action: 'preview-identity', contextId, payload: { uid } });
  assert.equal((await request('invalid')).ok, false);
  assert.equal(f.calls.profiles.length, 0);
  const result = await request('123');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { uid: '123', name: '预览昵称', avatarUrl: 'https://i0.hdslb.com/bfs/face/preview.jpg' });
  assert.equal(f.calls.execute.length, 1, 'preview does not read or write stored fan records');
});

test('identity preview shares an in-flight UID and rejects replaced or invalidated results', async (t) => {
  const pending = deferred();
  const f = fixture(t, { profile: () => pending.promise });
  const { contextId } = f.invoke({ action: 'open' });
  const request = (uid) => f.invoke({ action: 'preview-identity', contextId, payload: { uid } });
  const first = request('123');
  const shared = request('123');
  const replacement = request('456');
  assert.equal(f.calls.profiles.length, 2);
  assert.equal(f.calls.profiles[0].signal.aborted, true);
  f.state.streamerId = 'streamer-b';
  f.state.epoch++;
  f.invoke({ action: 'open' });
  assert.equal(f.calls.profiles[1].signal.aborted, true);
  pending.resolve({ name: '迟到资料', avatarUrl: '' });
  for (const result of await Promise.all([first, shared, replacement])) assert.equal(result.ok, false);
});

test('disposing the fan controller cancels identity preview and waits for its completion', async (t) => {
  const pending = deferred();
  const f = fixture(t, { profile: () => pending.promise });
  const { contextId } = f.invoke({ action: 'open' });
  const preview = f.invoke({ action: 'preview-identity', contextId, payload: { uid: '123' } });
  f.controller.dispose();
  assert.equal(f.calls.profiles[0].signal.aborted, true);
  pending.resolve({ name: '迟到资料' });
  assert.equal((await preview).ok, false);
  await f.controller.whenIdle();
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
  assert.match(
    f.invoke({ action: 'save', contextId: opened.contextId, payload: { notes: '不得串档' } }).error,
    /登录状态已变化/,
  );
  opened = f.invoke({ action: 'open' });
  assert.equal(f.calls.execute.at(-1).scope, SCOPE_B);
  f.state.origin = 'https://other.example';
  assert.match(f.invoke({ action: 'save', contextId: opened.contextId }).error, /登录状态已变化/);
  assert.equal(
    f.calls.execute.some((call) => call.action === 'save'),
    false,
  );
});

test('same-account renewal keeps the profile context and permits saving an already open editor', async (t) => {
  for (const notify of [false, true]) {
    const f = fixture(t, { initialized: false });
    const opened = f.invoke({ action: 'open' });
    f.state.epoch++;
    if (notify) f.emit();
    const saved = f.invoke({
      action: 'save',
      contextId: opened.contextId,
      payload: { id: 'fictional-profile', notes: '续期前已经输入的备注' },
    });
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
    assert.equal(
      f.calls.execute.some((call) => call.action === 'save'),
      false,
    );
    assert.notEqual(f.invoke({ action: 'open' }).contextId, opened.contextId);
    await f.controller.whenIdle();
  }
});

test('switching back to a previous streamer or server never revives its old context, even without an intermediate read', (t) => {
  for (const [key, value, observeSwitch] of [
    ['streamerId', 'streamer-b', true],
    ['origin', 'https://other.example', true],
    ['streamerId', 'streamer-b', false],
  ]) {
    const f = fixture(t);
    const originalValue = f.state[key];
    const opened = f.invoke({ action: 'open' });
    f.state[key] = value;
    f.state.generation++;
    if (observeSwitch) assert.notEqual(f.invoke({ action: 'open' }).contextId, opened.contextId);
    f.state[key] = originalValue;
    f.state.generation++;
    assert.equal(f.invoke({ action: 'save', contextId: opened.contextId }).ok, false);
    assert.equal(
      f.calls.execute.some((call) => call.action === 'save'),
      false,
    );
    assert.notEqual(f.invoke({ action: 'open' }).contextId, opened.contextId);
  }
});

test('fan IPC uses main-process scope despite renderer-supplied owner fields and redacts raw storage errors', (t) => {
  const f = fixture(t);
  const opened = f.invoke({ action: 'open' });
  assert.equal(
    f.invoke({
      action: 'save',
      contextId: opened.contextId,
      scope: SCOPE_B,
      payload: { scope: SCOPE_B, streamerId: 'streamer-b' },
    }).ok,
    true,
  );
  assert.equal(f.calls.execute.at(-1).scope, SCOPE_A);
  f.service.execute = () => {
    throw new Error('SQLITE_ERROR token=fictional-secret');
  };
  const failed = f.invoke({ action: 'save', contextId: opened.contextId });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.includes('fictional-secret'), false);
});
