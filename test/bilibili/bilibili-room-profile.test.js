'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BilibiliApiClient } = require('../../src/bilibili/danmaku/api-client');
const { createBilibiliRuntime } = require('../../src/server/bilibili-runtime');
const { routes } = require('../../src/server/routes/bilibili-routes');
const { createServerRuntime } = require('../../src/server');
const { projectOverlayResponse } = require('../../src/server/overlay-projection');

function createRuntime(t, roomId = '123') {
  const runtime = createBilibiliRuntime({
    settingsStore: { getSettings: () => ({ roomId, enableBilibili: 'false' }) },
    domainServices: { requesterTargets: { getLatestRandomRequester: () => null } },
    broadcastSnapshot() {},
    buildClient() {
      assert.fail('Reading room identity must not start a listener');
    },
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
    roomId: '',
    uid: '',
    name: '',
    avatarUrl: '',
  });
});

test('management room details reuse the owner lookup and read the resolved room without starting listeners', async (t) => {
  const runtime = createRuntime(t);
  const requests = [];
  t.mock.method(BilibiliApiClient.prototype, 'fetchJson', async (endpoint, url) => {
    requests.push(endpoint);
    const query = new URL(url).searchParams;
    if (endpoint === 'room_init') return { payload: { code: 0, data: { room_id: 123000, uid: 456, live_status: 2 } } };
    if (endpoint === 'master_info') {
      assert.equal(query.get('uid'), '456');
      return { payload: { code: 0, data: {
        info: { uid: 456, uname: '房主', face: '//i0.hdslb.com/owner.jpg' },
        exp: { master_level: { level: 23 } }, follower_num: 2444264, medal_name: '粉丝牌', room_news: { content: '' },
      } } };
    }
    assert.equal(endpoint, 'room_info');
    assert.equal(query.get('room_id'), '123000');
    return { payload: { code: 0, data: { room_id: 123000, title: '直播标题', live_status: 1, parent_area_name: '娱乐', area_name: '唱见' } } };
  });
  const profile = await runtime.getRoomProfile({ includeDetails: true });
  assert.equal(profile.name, '房主');
  assert.equal(profile.avatarUrl, 'https://i0.hdslb.com/owner.jpg');
  assert.equal(profile.title, '直播标题');
  assert.equal(profile.liveStatus, 1);
  assert.equal(profile.level, 23);
  assert.equal(profile.followers, 2444264);
  assert.equal(profile.medalName, '粉丝牌');
  assert.equal(profile.announcement, '');
  assert.equal(profile.parentAreaName, '娱乐');
  assert.equal(profile.areaName, '唱见');
  assert.equal(requests.length, 3, 'One room resolution, one owner lookup and one room detail lookup');
});

test('optional detail failures retain owner identity and distinguish unknown values from empty values', async (t) => {
  const runtime = createRuntime(t);
  t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', async () => ({ roomId: 123000, uid: 456, liveStatus: 0 }));
  t.mock.method(BilibiliApiClient.prototype, 'fetchOwnerProfile', async () => { throw new Error('Unavailable'); });
  t.mock.method(BilibiliApiClient.prototype, 'fetchRoomDetails', async () => null);
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async () => ({ name: '房主', avatarUrl: '' }));
  const profile = await runtime.getRoomProfile({ includeDetails: true });
  assert.equal(profile.uid, '456');
  assert.equal(profile.name, '房主');
  assert.equal(profile.liveStatus, 0);
  assert.equal(profile.followers, null);
  assert.equal(profile.announcement, null);
});

test('room identity remains available when optional avatar lookup fails', async (t) => {
  const runtime = createRuntime(t);
  t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', async () => ({
    roomId: 123000,
    uid: 456,
    ownerName: '直播间主人',
  }));
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async () => {
    throw new Error('Upstream unavailable');
  });
  assert.deepEqual(await runtime.getRoomProfile(), {
    roomId: '123000',
    uid: '456',
    name: '直播间主人',
    avatarUrl: '',
  });
});

test('room profile rejects another room before loading its owner details', async (t) => {
  const runtime = createRuntime(t);
  t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', async () => ({
    roomId: 123000, shortId: 123, uid: 456,
  }));
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', () => {
    assert.fail('A mismatching room must not load owner details');
  });
  assert.equal(await runtime.getRoomProfile({ expectedRoomId: '999' }), null);
});

test('room profile route returns the projection and hides upstream error details', async () => {
  const profile = { roomId: '123', uid: '456', name: '房主', avatarUrl: '', title: '直播标题' };
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.payload = JSON.parse(body);
    },
  };
  const detailRequests = [];
  const context = { bilibili: { getRoomProfile: async (options) => { detailRequests.push(options.includeDetails); return profile; } } };
  await routes['GET /api/bilibili/room/profile'](context, {}, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { ok: true, data: profile });
  await routes['GET /api/bilibili/room/profile'](context, {}, response,
    (data) => projectOverlayResponse('danmaku', '/api/bilibili/room/profile', data));
  assert.deepEqual(Object.keys(response.payload.data).sort(), ['avatarUrl', 'name', 'roomId', 'uid']);
  assert.deepEqual(detailRequests, [true, false], 'Overlay reads must not request management details');

  context.bilibili.getRoomProfile = async () => {
    throw new Error('private-detail');
  };
  await routes['GET /api/bilibili/room/profile'](context, {}, response);
  assert.equal(response.status, 502);
  assert.equal(response.payload.ok, false);
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
