'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QQMusicClient } = require('../src/music/providers/qq-provider-client');

const calls = [
  (client) => client.requestMusicuPost({}),
  (client) => client.requestMusicsClient({}),
  (client) => client.requestQQEncryptedVkey({}),
  (client) => client.requestJson('https://example.test/synthetic'),
  (client) => client.requestPlaylistWrite('Test', { dirId: 1 }, []),
];
const body = {
  code: 0,
  'music.musicasset.PlaylistDetailWrite.Test': { code: 0, data: { retCode: 0, result: { saved: true } } },
};

function client() {
  return new QQMusicClient({ getCookieHeader: () => 'qqmusic_uin=123456; qm_keyst=synthetic; qqmusic_key=synthetic' });
}

test('QQ request paths share JSON/JSONP parsing and read each response once', async (t) => {
  let responseBody;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    text: async () => {
      reads += 1;
      return responseBody;
    },
  }));
  for (const wrapped of [false, true]) {
    responseBody = wrapped ? `callback(${JSON.stringify(body)});` : JSON.stringify(body);
    for (const [index, request] of calls.entries()) {
      const before = reads;
      assert.deepEqual(await request(client()), index === 4 ? { saved: true } : body);
      assert.equal(reads, before + 1);
    }
  }
});

test('QQ response failures preserve HTTP precedence, parse wrapping and body-read errors', async (t) => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const request of calls) {
    response = { ok: false, status: 503, text: async () => '<invalid>' };
    await assert.rejects(request(client()), { message: 'HTTP 503' });
    response = { ok: true, text: async () => '<invalid>' };
    await assert.rejects(request(client()), /QQ 音乐返回了非 JSON 响应：/);
    const readError = new Error('synthetic stream failure');
    response = {
      ok: false,
      status: 503,
      text: async () => {
        throw readError;
      },
    };
    await assert.rejects(request(client()), (error) => error === readError);
  }
});
