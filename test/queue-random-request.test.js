'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../src/server');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');

test('queue random uses the logged-in account and existing danmaku request rules', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-queue-random-'));
  const runtime = createServerRuntime({ dataDir });
  let account = { loggedIn: false, uid: 0 };
  const profileUids = [];
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async (uid) => {
    profileUids.push(String(uid));
    return { name: `账号${uid}` };
  });
  t.after(async () => {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const app = await runtime.start({
    host: '127.0.0.1',
    startPort: 0,
    bilibiliAuth: {
      getAuthState: async () => account,
      getUid: async () => account.uid,
      getCookieHeader: async () => '',
    },
  });
  const token = runtime.getApiToken();
  async function post(route, body = {}) {
    const response = await fetch(`${app.baseUrl}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  }
  async function expectRejected(pattern) {
    const result = await post('/api/queue/random');
    assert.equal(result.status, 400);
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
  }

  const unauthorized = await fetch(`${app.baseUrl}/api/queue/random`, {
    method: 'POST',
  });
  assert.equal(unauthorized.status, 401);
  await expectRejected(/请先登录/);
  account = { loggedIn: true, uid: 42 };
  await post('/api/settings', {
    paused: false, userCooldownSeconds: 0, allowDuplicate: false,
  });
  await expectRejected(/没有可随机歌曲/);
  const disabled = await post('/api/songs/save', { name: '不可点歌曲' });
  await post('/api/songs/toggle', { id: disabled.data.id });
  await expectRejected(/没有可随机歌曲/);
  await post('/api/songs/save', {
    name: '测试随机歌', artist: '测试歌手', categoryName: '国语',
  });
  await post('/api/settings', { paused: true });
  await expectRejected(/暂停接收点歌/);
  await post('/api/settings', { paused: false, userCooldownSeconds: 60 });
  const accepted = await post('/api/queue/random', {
    requesterUid: 'forged', requesterName: '伪造账号', message: '点歌 伪造歌曲',
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.song_name, '测试随机歌');
  assert.equal(accepted.data.artist, '测试歌手');
  assert.equal(accepted.data.requester_uid, '42');
  assert.equal(accepted.data.requester_name, '账号42');
  assert.equal(accepted.data.source, 'random');
  assert.equal(accepted.data.category_name, '国语');
  await expectRejected(/冷却中/);
  await post('/api/settings', { userCooldownSeconds: 0 });
  await expectRejected(/已经有这首歌/);
  await post('/api/settings', { allowDuplicate: true, queueLimit: 1 });
  await expectRejected(/队列已达到上限/);
  await post('/api/queue/action', { action: 'clear' });
  account = { loggedIn: true, uid: 43 };
  const nextAccount = await post('/api/queue/random');
  assert.equal(nextAccount.data.requester_uid, '43');
  assert.equal(nextAccount.data.requester_name, '账号43');
  assert.deepEqual(profileUids, ['42', '43']);
  account = { loggedIn: false, uid: 0 };
  await expectRejected(/请先登录/);
});
