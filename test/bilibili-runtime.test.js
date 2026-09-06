'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBilibiliRuntime } = require('../src/server/bilibili-runtime');

test('Bilibili runtime owns auth refresh, client replacement, and shutdown', async () => {
  const settings = {
    roomId: '123',
    enableBilibili: 'true',
  };
  const clients = [];
  const activeRooms = [];
  const runtime = createBilibiliRuntime({
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
    const fixture = createReplacementFixture({ getCookieHeader: () => auth.promise });
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
  const fixture = createReplacementFixture({ getCookieHeader: () => auth.promise });
  t.after(() => fixture.runtime.stop());
  const first = fixture.runtime.reconnect();
  await new Promise((resolve) => setImmediate(resolve));
  fixture.settings.roomId = '456';
  const second = fixture.runtime.reconnect();
  auth.resolve('synthetic-cookie');
  await Promise.all([first, second]);

  assert.deepEqual(fixture.clients.map((client) => client.roomId), ['456']);
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
  assert.equal(fixture.runtime.getLiveStatus().message, '未启用 Bilibili 监听');
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
  assert.deepEqual(fixture.clients.map((client) => client.roomId), ['123', '123']);
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

function createReplacementFixture(options = {}) {
  const settings = { roomId: '123', enableBilibili: 'true' };
  const clients = [];
  const runtime = createBilibiliRuntime({
    settingsStore: { getSettings: () => settings },
    domainServices: { requesterTargets: { getLatestRandomRequester: () => null } },
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
        stop() { this.stopCount += 1; },
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
