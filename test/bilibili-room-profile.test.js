'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const { createBilibiliRuntime } = require('../src/server/bilibili-runtime');
const { routes } = require('../src/server/routes/bilibili-routes');
const { createServerRuntime } = require('../src/server');

function createRuntime(t, roomId = '123') {
  const runtime = createBilibiliRuntime({
    settingsStore: { getSettings: () => ({ roomId, enableBilibili: 'false' }) },
    domainServices: { requesterTargets: { getLatestRandomRequester: () => null } },
    broadcastSnapshot() {},
    buildClient() { assert.fail('Reading room identity must not start a listener'); },
  });
  t.after(() => runtime.stop());
  return runtime;
}

test('room profile resolves the saved room owner independently of the login account', async (t) => {
  t.mock.method(console, 'info', () => {});
  const runtime = createRuntime(t, 'https://live.bilibili.com/123');
  runtime.setAuthProvider({
    getCookieHeader: async () => 'SESSDATA=synthetic-session',
    getUid: async () => 99,
  });
  t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', async function () {
    assert.equal(this.roomId, '123');
    assert.equal(this.uid, 99);
    return { roomId: 123000, uid: 456, ownerName: '房主旧昵称' };
  });
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async (uid) => {
    assert.equal(uid, '456');
    return { name: '直播间主人', avatarUrl: 'https://i0.hdslb.com/bfs/face/owner.jpg' };
  });

  assert.deepEqual(await runtime.getRoomProfile(), {
    roomId: '123000',
    uid: '456',
    name: '直播间主人',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/owner.jpg',
  });
});

test('an unset room does not trigger an upstream lookup', async (t) => {
  const runtime = createRuntime(t, '');
  t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', () => {
    assert.fail('An unset room must not be resolved');
  });
  assert.deepEqual(await runtime.getRoomProfile(), {
    roomId: '', uid: '', name: '', avatarUrl: '',
  });
});

test('room identity remains available when optional avatar lookup fails', async (t) => {
  const runtime = createRuntime(t);
  t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', async () => ({
    roomId: 123000, uid: 456, ownerName: '直播间主人',
  }));
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async () => {
    throw new Error('Upstream unavailable');
  });
  assert.deepEqual(await runtime.getRoomProfile(), {
    roomId: '123000', uid: '456', name: '直播间主人', avatarUrl: '',
  });
});

test('room profile route returns the projection and hides upstream error details', async () => {
  const profile = { roomId: '123', uid: '456', name: '房主', avatarUrl: '' };
  const response = {
    writeHead(status) { this.status = status; },
    end(body) { this.payload = JSON.parse(body); },
  };
  const context = { bilibili: { getRoomProfile: async () => profile } };
  await routes['GET /api/bilibili/room/profile'](context, {}, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { ok: true, data: profile });

  context.bilibili.getRoomProfile = async () => { throw new Error('private-detail'); };
  await routes['GET /api/bilibili/room/profile'](context, {}, response);
  assert.equal(response.status, 502);
  assert.equal(response.payload.ok, false);
  assert.match(response.payload.error, /检查房间号/);
  assert.doesNotMatch(JSON.stringify(response.payload), /private-detail/);
});

test('room profile is wired through the server and requires management authentication', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-room-profile-'));
  const runtime = createServerRuntime({ dataDir: directory });
  t.after(async () => {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = await runtime.start({ host: '127.0.0.1', startPort: port });
  const url = `${server.baseUrl}/api/bilibili/room/profile`;
  const anonymous = await fetch(url);
  assert.equal(anonymous.ok, false);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${runtime.getApiToken()}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { roomId: '', uid: '', name: '', avatarUrl: '' },
  });
});
