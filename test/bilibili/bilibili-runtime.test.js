'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBilibiliRuntime } = require('../../src/server/bilibili-runtime');

test('configured-room guard counts update even while local danmaku monitoring is disabled', async (t) => {
  const settings = { roomId: '52030', enableBilibili: 'false' };
  const broadcasts = [];
  const pending = [];
  const runtime = createBilibiliRuntime({
    settingsStore: { getSettings: () => settings }, domainServices: {},
    broadcastSnapshot: reason => broadcasts.push(reason),
    readRoomGuardCount(roomId, { signal }) {
      const read = Promise.withResolvers();
      pending.push({ ...read, roomId, signal });
      return read.promise;
    },
  });
  t.after(() => runtime.stop());
  runtime.configure();
  pending[0].resolve(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.getRoomGuardState(), { roomId: '52030', count: 1000 });
  settings.roomId = '42';
  runtime.configure();
  assert.deepEqual(runtime.getRoomGuardState(), { roomId: '42', count: null });
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(999);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.getRoomGuardState(), { roomId: '42', count: 999 });
  assert.ok(broadcasts.includes('bilibili:room-guard'));
});

test('Bilibili runtime owns auth refresh, client replacement, and shutdown', async (t) => {
  const logs = [];
  t.mock.method(console, 'info', (line) => logs.push(line));
  const settings = {
    roomId: '123',
    enableBilibili: 'true',
  };
  const clients = [];
  const activeRooms = [];
  const runtime = createBilibiliRuntime({
    readRoomGuardCount: async () => null,
    settingsStore: { getSettings: () => settings },
    domainServices: {
      requesterTargets: { getLatestRandomRequester: () => null },
    },
    broadcastSnapshot() {},
    setActiveDanmakuRoom: (roomId) => activeRooms.push(roomId),
    buildClient(roomId, context) {
      const client = {
        roomId,
        context,
        restartCount: 0,
        stopCount: 0,
        apiClient: { updateAuth() {} },
        start() {},
        async restart() {
          this.restartCount += 1;
        },
        stop() {
          this.stopCount += 1;
        },
      };
      clients.push(client);
      return client;
    },
  });
  runtime.setAuthProvider({
    getAuthState: async () => ({ loggedIn: true, uid: 42 }),
    getCookieHeader: async () => 'SESSDATA=test',
    getUid: async () => 42,
  });

  await runtime.reconnect();

  assert.equal(clients.length, 1);
  assert.equal(clients[0].roomId, '123');
  assert.equal(clients[0].restartCount, 1);
  assert.deepEqual(clients[0].context.bilibiliAuthCache, {
    cookieHeader: 'SESSDATA=test',
    uid: 42,
  });
  assert.deepEqual(activeRooms, ['123']);
  const events = logs.map((line) => JSON.parse(line.split('[Bilibili][Diagnostic] ')[1]));
  assert.equal(events[0].event, 'refresh-requested');
  assert.ok(events.some((event) => event.event === 'auth-cache-changed'));
  const created = events.find((event) => event.event === 'listener-created');
  assert.equal(created.hasSessdata, true);
  assert.equal(created.clientGeneration, clients[0].context.bilibiliClientGeneration);
  assert.doesNotMatch(logs.join('\n'), /SESSDATA=test/);

  settings.enableBilibili = 'false';
  runtime.configure(true);
  assert.equal(activeRooms.at(-1), '');

  runtime.stop();
  assert.equal(clients[0].stopCount, 1);
  await assert.rejects(runtime.reconnect(), /shutting down/);
});

for (const cancellation of ['disable', 'disconnect', 'stop']) {
  test(`pending auth cannot start a client after ${cancellation}`, async (t) => {
    const auth = Promise.withResolvers();
    const fixture = createReplacementFixture({
      getCookieHeader: () => auth.promise,
    });
    t.after(() => fixture.runtime.stop());
    const pending = fixture.runtime.reconnect();
    await new Promise((resolve) => setImmediate(resolve));

    if (cancellation === 'disable') {
      fixture.settings.enableBilibili = 'false';
      fixture.runtime.configure();
    } else {
      fixture.runtime[cancellation]();
    }
    auth.resolve('synthetic-cookie');
    await pending;

    assert.equal(fixture.clients.length, 0);
  });
}

test('queued reconnect is invalidated before it starts and can be enabled again', async (t) => {
  const fixture = createReplacementFixture();
  t.after(() => fixture.runtime.stop());
  const pending = fixture.runtime.reconnect();
  fixture.settings.enableBilibili = 'false';
  fixture.runtime.configure();
  fixture.settings.enableBilibili = 'true';
  const resumed = fixture.runtime.reconnect();
  await Promise.all([pending, resumed]);

  assert.equal(fixture.clients.length, 1);
  assert.equal(fixture.clients[0].restartCount, 1);
});

test('only the latest requested room starts after pending auth resolves', async (t) => {
  const auth = Promise.withResolvers();
  const fixture = createReplacementFixture({
    getCookieHeader: () => auth.promise,
  });
  t.after(() => fixture.runtime.stop());
  const first = fixture.runtime.reconnect();
  await new Promise((resolve) => setImmediate(resolve));
  fixture.settings.roomId = '456';
  const second = fixture.runtime.reconnect();
  auth.resolve('synthetic-cookie');
  await Promise.all([first, second]);

  assert.deepEqual(
    fixture.clients.map((client) => client.roomId),
    ['456'],
  );
});

test('local commands follow danmaku monitoring independently of gift monitoring', async (t) => {
  const fixture = createReplacementFixture();
  t.after(() => fixture.runtime.stop());
  fixture.settings.danmakuMonitoringEnabled = 'true';
  fixture.settings.giftMonitoringEnabled = 'true';
  await fixture.runtime.reconnect();
  const client = fixture.clients[0];
  fixture.settings.giftMonitoringEnabled = 'false';
  fixture.runtime.configure();
  assert.equal(fixture.clients.length, 1);
  assert.equal(client.stopCount, 0);
  fixture.settings.giftMonitoringEnabled = 'true';
  fixture.settings.danmakuMonitoringEnabled = 'false';
  fixture.runtime.configure();
  assert.equal(client.stopCount, 1);
  assert.equal(client.context.isShuttingDown(), true);
  assert.equal(fixture.runtime.getLiveStatus().enabled, false);
  await fixture.runtime.reconnect();
  assert.equal(fixture.clients.length, 1);
  fixture.settings.danmakuMonitoringEnabled = 'true';
  await fixture.runtime.reconnect();
  assert.equal(fixture.clients.length, 2);
});

test('missing room status is distinct from disabled listening', async (t) => {
  const fixture = createReplacementFixture();
  t.after(() => fixture.runtime.stop());
  fixture.settings.roomId = '';
  fixture.runtime.configure();
  assert.equal(fixture.runtime.getLiveStatus().message, '未设置直播间');
  const { liveStatus } = await fixture.runtime.reconnect();
  assert.equal(liveStatus.message, '未设置直播间');
  assert.equal(fixture.clients.length, 0);

  fixture.settings.roomId = '123';
  fixture.settings.enableBilibili = 'false';
  fixture.runtime.configure();
  assert.equal(fixture.runtime.getLiveStatus().message, '未启用弹幕监听');
});

test('disabled client cannot report late status or restart failure', async (t) => {
  const restart = Promise.withResolvers();
  const fixture = createReplacementFixture({ restart: () => restart.promise });
  t.after(() => fixture.runtime.stop());
  const pending = fixture.runtime.reconnect();
  await new Promise((resolve) => setImmediate(resolve));
  const client = fixture.clients[0];
  fixture.settings.enableBilibili = 'false';
  fixture.runtime.configure();
  client.context.updateLiveStatus({ connected: true, enabled: true });
  restart.reject(new Error('obsolete restart failed'));
  await pending;

  assert.equal(client.stopCount, 1);
  assert.equal(client.context.isShuttingDown(), true);
  assert.equal(fixture.runtime.getLiveStatus().enabled, false);
});

test('unchanged settings keep the active client and rapid room changes use the latest room', async (t) => {
  const fixture = createReplacementFixture();
  t.after(() => fixture.runtime.stop());
  await fixture.runtime.reconnect();
  const original = fixture.clients[0];
  fixture.runtime.configure();
  assert.equal(original.stopCount, 0);
  assert.equal(original.context.isShuttingDown(), false);

  fixture.settings.roomId = '456';
  const intermediate = fixture.runtime.reconnect();
  fixture.settings.roomId = '123';
  fixture.runtime.configure();
  await intermediate;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(original.stopCount, 1);
  assert.deepEqual(
    fixture.clients.map((client) => client.roomId),
    ['123', '123'],
  );
});

test('current restart errors still reject without blocking a later reconnect', async (t) => {
  let attempts = 0;
  const fixture = createReplacementFixture({
    restart() {
      if (++attempts === 1) throw new Error('current restart failed');
    },
  });
  t.after(() => fixture.runtime.stop());
  await assert.rejects(fixture.runtime.reconnect(), /current restart failed/);
  await fixture.runtime.reconnect();
  assert.equal(attempts, 2);
  assert.equal(fixture.clients[0].stopCount, 1);
});

test('like state follows the configured room and is unavailable after disconnect', async (t) => {
  t.mock.method(console, 'info', () => {});
  const fixture = createReplacementFixture();
  t.after(() => fixture.runtime.stop());
  const unknown = { roomId: '123', count: null, updatedAt: null, connected: false };
  assert.deepEqual(fixture.runtime.getLikeState(), unknown);
  await fixture.runtime.reconnect();
  const state = { roomId: '100123', count: 42, updatedAt: '2026-10-10T01:00:00.000Z', connected: true };
  fixture.clients[0].getLikeState = () => state;
  assert.deepEqual(fixture.runtime.getLikeState(), state);

  fixture.settings.roomId = '456';
  assert.deepEqual(fixture.runtime.getLikeState(), { ...unknown, roomId: '456' });
  await fixture.runtime.reconnect();
  const nextState = { ...state, roomId: '456', count: 0 };
  fixture.clients[1].getLikeState = () => nextState;
  assert.deepEqual(fixture.runtime.getLikeState(), nextState);
  fixture.runtime.disconnect();
  assert.deepEqual(fixture.runtime.getLikeState(), { ...unknown, roomId: '456' });
});

function createReplacementFixture(options = {}) {
  const settings = { roomId: '123', enableBilibili: 'true' };
  const clients = [];
  const runtime = createBilibiliRuntime({
    readRoomGuardCount: async () => null,
    settingsStore: { getSettings: () => settings },
    domainServices: {
      requesterTargets: { getLatestRandomRequester: () => null },
    },
    broadcastSnapshot() {},
    buildClient(roomId, context) {
      const client = {
        roomId,
        context,
        restartCount: 0,
        stopCount: 0,
        start() {},
        async restart() {
          this.restartCount += 1;
          await options.restart?.();
        },
        stop() {
          this.stopCount += 1;
        },
      };
      clients.push(client);
      return client;
    },
  });
  runtime.setAuthProvider({
    getCookieHeader: options.getCookieHeader || (async () => 'synthetic-cookie'),
    getUid: async () => 42,
  });
  return { runtime, settings, clients };
}
