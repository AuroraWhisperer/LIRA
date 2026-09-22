'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanScopeFor } = require('../src/electron/fan-profile-controller');
const { fixture, deferred, ORIGIN, SCOPE_A, SCOPE_B } = require('./helpers/fan-profile-controller-fixture');

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
  assert.equal(
    f.calls.execute.every((call) => call.scope === SCOPE_A && call.action === 'list'),
    true,
  );
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
    `${ORIGIN}/song-board`,
    `${ORIGIN}/overlay`,
    `${ORIGIN}/admin/extra`,
    `${ORIGIN}/public/pages/admin/index.html`,
    'http://127.0.0.1:3001/admin',
    'http://localhost:3000/admin',
    'https://127.0.0.1:3000/admin',
    'http://127.0.0.1.attacker.example:3000/admin',
    'https://lira.example/admin',
    'file:///admin',
    'not-a-url',
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

test('switching back to a previous streamer or server never revives its old context', (t) => {
  for (const [key, value] of [
    ['streamerId', 'streamer-b'],
    ['origin', 'https://other.example'],
  ]) {
    const f = fixture(t);
    const originalValue = f.state[key];
    const opened = f.invoke({ action: 'open' });
    f.state[key] = value;
    assert.notEqual(f.invoke({ action: 'open' }).contextId, opened.contextId);
    f.state[key] = originalValue;
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
  assert.match(failed.error, /尚未保存/);
});
