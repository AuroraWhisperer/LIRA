'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const { getBilibiliWbiMixinKey } = require('../src/bilibili/wbi-signer');
const { fetchGuardRoster } = require('../src/bilibili/guard-roster');

function oversizedResponse(contentType = 'application/json') {
  let reads = 0;
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        reads += 1;
        if (reads <= 12) controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'Content-Type': contentType } },
  );
  return { response, reads: () => reads, cancelled: () => cancelled };
}

for (const [name, invoke, contentType] of [
  ['API JSON', (client) => client.fetchJson('gethistory', 'https://api.live.bilibili.com/fixture')],
  ['WBI keys', () => getBilibiliWbiMixinKey({})],
  ['avatar image', (client) => client.fetchAvatarImage('https://i0.hdslb.com/bfs/face/test.png'), 'image/png'],
  ['guard roster', () => fetchGuardRoster('123')],
]) {
  test(`${name} cancels an oversized chunked response before consuming it all`, async (t) => {
    const source = oversizedResponse(contentType);
    t.mock.method(global, 'fetch', async () => source.response);
    await assert.rejects(invoke(new BilibiliApiClient('123')), /过大|size limit/);
    assert.equal(source.cancelled(), true);
    assert.ok(source.reads() < 12);
  });
}

for (const [name, invoke] of [
  ['API JSON', (client) => client.fetchJson('gethistory', 'https://api.live.bilibili.com/fixture')],
  ['WBI keys', () => getBilibiliWbiMixinKey({})],
  ['danmaku send', (client) => client.sendDanmaku('123', 'synthetic message')],
]) {
  test(`${name} provides a deadline on an authenticated request`, async (t) => {
    t.mock.method(AbortSignal, 'timeout', () => {
      const controller = new AbortController();
      setImmediate(() => controller.abort(new Error('request deadline exceeded')));
      return controller.signal;
    });
    t.mock.method(global, 'fetch', async (url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    });
    const client = new BilibiliApiClient('123', { cookieHeader: 'bili_jct=synthetic-session' });
    await assert.rejects(invoke(client), /request deadline exceeded/);
  });
}

test('invalid API and WBI response errors omit unstructured upstream private content', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('<html>synthetic-private-account-data</html>'));
  for (const invoke of [
    () => new BilibiliApiClient('123').fetchJson('gethistory', 'https://api.live.bilibili.com/fixture'),
    () => getBilibiliWbiMixinKey({}),
  ]) {
    await assert.rejects(invoke(), (error) => {
      assert.match(error.message, /non-JSON/);
      assert.doesNotMatch(error.message, /synthetic-private-account-data/);
      return true;
    });
  }
});
