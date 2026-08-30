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
