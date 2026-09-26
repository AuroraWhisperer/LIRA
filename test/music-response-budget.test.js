'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QQMusicClient } = require('../src/music/providers/qq-provider-client');
const { NeteaseMusicProvider } = require('../src/music/providers/netease-provider');

test('music JSON, JSONP and text paths stop oversized chunked responses', async (t) => {
  const qq = new QQMusicClient();
  const netease = new NeteaseMusicProvider();
  let pulls;
  let cancelled;
  t.mock.method(globalThis, 'fetch', async () => {
    pulls = 0;
    cancelled = false;
    return new Response(new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(Buffer.alloc(1024 * 1024, ' '));
        if (pulls === 20) {
          controller.enqueue(Buffer.from('{}'));
          controller.close();
        }
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }));
  });
  for (const request of [
    () => qq.requestJson('https://music.test'),
    () => qq.requestText('https://music.test'),
    () => netease.requestJson('/test'),
    () => netease.requestWeapiJson('/test', {}),
  ]) {
    await assert.rejects(request(), { code: 'MUSIC_RESPONSE_TOO_LARGE' });
    assert.equal(pulls, 17);
    assert.equal(cancelled, true);
  }
});
