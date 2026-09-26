'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const { parseBilibiliPackets } = require('../src/bilibili/parsers/packet-decoder');

const PACKET_BUDGET = 8 * 1024 * 1024;

function packet(body, version = 0) {
  const bytes = Buffer.from(body);
  const result = Buffer.alloc(16 + bytes.length);
  result.writeUInt32BE(result.length);
  result.writeUInt16BE(16, 4);
  result.writeUInt16BE(version, 6);
  result.writeUInt32BE(5, 8);
  result.writeUInt32BE(1, 12);
  bytes.copy(result, 16);
  return result;
}

function sizedMessage(size) {
  const json = '{"cmd":"SAFE"}';
  return packet(json + ' '.repeat(size - 16 - json.length));
}

test('mixed compressed packets share the exact cumulative decompression budget', (t) => {
  const half = sizedMessage(PACKET_BUDGET / 2);
  const first = packet(zlib.deflateSync(half), 2);
  const second = packet(zlib.brotliCompressSync(half), 3);
  const tail = packet(zlib.deflateSync(packet('{"cmd":"UNREAD"}')), 2);
  const inflate = t.mock.method(zlib, 'inflateSync');
  const brotli = t.mock.method(zlib, 'brotliDecompressSync');
  assert.deepEqual(parseBilibiliPackets(Buffer.concat([first, second, tail])), [{ cmd: 'SAFE' }, { cmd: 'SAFE' }]);
  assert.equal(inflate.mock.callCount(), 1);
  assert.equal(brotli.mock.callCount(), 1);
  assert.equal(inflate.mock.calls[0].arguments[1].maxOutputLength, PACKET_BUDGET);
  assert.equal(brotli.mock.calls[0].arguments[1].maxOutputLength, PACKET_BUDGET / 2);
});

test('packet flood applies message and compression limits independently on repeated frames', (t) => {
  const json = JSON.stringify({ cmd: 'DANMU_MSG', info: [0, 'quoted } { \\" text'] });
  const plain = packet(json.repeat(12000));
  const compressed = packet(zlib.deflateSync(plain), 2);
  let decoded = 0;
  for (let index = 0; index < 32; index += 1) {
    const messages = parseBilibiliPackets(index % 2 ? plain : compressed);
    assert.equal(messages.length, 10000);
    assert.deepEqual(messages[0], JSON.parse(json));
    assert.deepEqual(messages.at(-1), JSON.parse(json));
    decoded += messages.length;
  }
  t.diagnostic(`32 input frames, ${decoded} messages admitted, 64000 excess messages discarded`);
  assert.deepEqual(parseBilibiliPackets(packet('{"cmd":"AFTER_FLOOD"}')), [{ cmd: 'AFTER_FLOOD' }]);
});

test('concurrent Bilibili requests release bodies on abort, overflow and valid responses', async (t) => {
  const states = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const index = states.length;
    const state = { pulls: 0, cancelled: 0, response: null, signal: options.signal };
    states.push(state);
    state.response = new Response(new ReadableStream({
      start(controller) {
        if (index % 3 === 0) {
          options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
        }
      },
      pull(controller) {
        state.pulls += 1;
        if (index % 3 === 1) controller.enqueue(new Uint8Array(1024 * 1024));
        if (index % 3 === 2) {
          controller.enqueue(Buffer.from('{"code":0,"data":{}}'));
          controller.close();
        }
      },
      cancel() { state.cancelled += 1; },
    }, { highWaterMark: 0 }));
    return state.response;
  });
  const controllers = Array.from({ length: 24 }, () => new AbortController());
  const client = new BilibiliApiClient('123');
  const settled = Promise.allSettled(controllers.map((controller) =>
    client.fetchJson('gethistory', 'https://api.example.test/fixture', { signal: controller.signal }),
  ));
  await new Promise(setImmediate);
  controllers.forEach((controller, index) => {
    if (index % 3 === 0) controller.abort(new Error('synthetic client cancellation'));
  });
  const results = await settled;
  for (let index = 0; index < results.length; index += 1) {
    assert.equal(states[index].response.body.locked, false);
    if (index % 3 === 0) {
      assert.equal(results[index].status, 'rejected');
      assert.equal(results[index].reason.message, 'synthetic client cancellation');
    } else if (index % 3 === 1) {
      assert.equal(results[index].status, 'rejected');
      assert.match(results[index].reason.message, /过大/);
      assert.equal(states[index].pulls, 5);
      assert.equal(states[index].cancelled, 1);
    } else {
      assert.equal(results[index].status, 'fulfilled');
      assert.equal(results[index].value.payload.code, 0);
    }
  }
});

for (const [status, contentType, expected, cancelFails] of [
  [502, 'image/png', /HTTP 502/, false],
  [200, 'text/html', /非图片/, false],
  [200, 'text/html', /非图片/, true],
]) {
  test(`avatar rejection cancels the unread ${status} ${contentType} response (cancel failure: ${cancelFails})`, async (t) => {
    let cancelled = 0;
    const response = new Response(new ReadableStream({
      cancel() {
        cancelled += 1;
        if (cancelFails) throw new Error('underlying response already failed');
      },
    }), { status, headers: { 'content-type': contentType } });
    t.mock.method(globalThis, 'fetch', async () => response);
    const client = new BilibiliApiClient('123');
    await assert.rejects(client.fetchAvatarImage('https://i0.hdslb.com/bfs/face/fixture.png'), expected);
    assert.equal(cancelled, 1);
    assert.equal(response.body.locked, false);
  });
}
