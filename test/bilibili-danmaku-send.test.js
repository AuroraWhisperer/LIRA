'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');

test('sends danmaku with visible mention and Bilibili reply metadata', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ code: 0, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const client = new BilibiliApiClient('123', {
      cookieHeader: 'DedeUserID=9; SESSDATA=session; bili_jct=csrf-token',
      uid: 9
    });
    const result = await client.sendDanmaku(123, '随机到这首歌', {
      uid: '456',
      name: 'Alice'
    });
    const form = new URLSearchParams(request.options.body);

    assert.equal(request.url, 'https://api.live.bilibili.com/msg/send');
    assert.equal(form.get('msg'), '随机到这首歌');
    assert.equal(form.get('reply_mid'), '456');
    assert.equal(form.get('reply_uname'), 'Alice');
    assert.equal(form.get('csrf'), 'csrf-token');
    assert.equal(result.message, '随机到这首歌');
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects danmaku sending without a logged-in cookie', async () => {
  const client = new BilibiliApiClient('123');
  await assert.rejects(client.sendDanmaku(123, 'hello'), /登录 Bilibili/);
});

test('rejects invalid reply uid before calling Bilibili', async () => {
  const client = new BilibiliApiClient('123', {
    cookieHeader: 'DedeUserID=9; SESSDATA=session; bili_jct=csrf-token',
    uid: 9
  });
  await assert.rejects(
    client.sendDanmaku(123, 'hello', { uid: 'not-a-uid', name: 'Alice' }),
    /UID/
  );
});
