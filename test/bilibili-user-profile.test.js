'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const { createBilibiliRuntime } = require('../src/server/bilibili-runtime');

const avatarUrl = 'https://i0.hdslb.com/bfs/face/synthetic.jpg';

test('profile requests normalize protocol-relative collection avatars to HTTPS', async (t) => {
  const face = '//i0.hdslb.com/bfs/garb/collection.png@152w_152h_1c_1s.webp';
  t.mock.method(BilibiliApiClient.prototype, 'fetchJson', async () => ({
    payload: { code: 0, data: { card: { name: '收藏集观众', face } } },
  }));
  assert.deepEqual(await new BilibiliApiClient('').fetchUserProfile('123'), {
    name: '收藏集观众',
    avatarUrl: `https:${face}`,
  });
});

test('profile requests forward a finite timeout and reject upstream business failures', async (t) => {
  t.mock.method(console, 'log', () => {});
  const controller = new AbortController();
  const timeout = t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let payload = { code: 0, data: { card: { name: 'Alice', face: avatarUrl } } };
  const fetch = t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.bilibili.com/x/web-interface/card?mid=123');
    assert.equal(options.signal, controller.signal);
    return Response.json(payload);
  });
  const client = new BilibiliApiClient('');
  assert.deepEqual(await client.fetchUserProfile('123'), { name: 'Alice', avatarUrl });
  assert.equal(timeout.mock.calls[0].arguments[0], 8000);
  for (const invalid of [
    { code: -412, data: null },
    { code: 0, data: {} },
  ]) {
    payload = invalid;
    await assert.rejects(client.fetchUserProfile('123'), /用户资料读取失败/);
  }
  assert.deepEqual(await client.fetchUserProfile('not-a-uid'), { name: '', avatarUrl: '' });
  assert.equal(fetch.mock.callCount(), 3);
});

test('the gift avatar facade uses the authenticated cached user service without starting a listener', async (t) => {
  t.mock.method(console, 'info', () => {});
  const runtime = createBilibiliRuntime({
    settingsStore: { getSettings: () => ({ roomId: '123', enableBilibili: 'false' }) },
    domainServices: { requesterTargets: { getLatestRandomRequester: () => null } },
    broadcastSnapshot() {},
    buildClient() {
      assert.fail('avatar lookup must not start a listener');
    },
  });
  t.after(() => runtime.stop());
  runtime.setAuthProvider({ getCookieHeader: async () => 'SESSDATA=synthetic', getUid: async () => 99 });
  const fetch = t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async function (uid) {
    assert.equal(uid, '456');
    assert.equal(this.cookieHeader, 'SESSDATA=synthetic');
    return { name: 'Alice', avatarUrl };
  });
  assert.deepEqual(await Promise.all([runtime.getUserAvatar('456'), runtime.getUserAvatar('456')]), [
    avatarUrl,
    avatarUrl,
  ]);
  assert.equal(await runtime.getUserAvatar('456'), avatarUrl);
  assert.equal(fetch.mock.callCount(), 1);
});
