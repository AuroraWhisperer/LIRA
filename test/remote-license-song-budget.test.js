'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');

const MAX_BYTES = 8 * 1024 * 1024;

test('song snapshots accept the exact 8 MiB UTF-8 boundary without raising auth limits', async () => {
  const payload = { songs: [{ title: '歌曲\u0000"\\', note: '' }], initialized: true, revision: 1, updatedAt: null };
  payload.songs[0].note = 'x'.repeat(MAX_BYTES - Buffer.byteLength(JSON.stringify(payload)));
  let body = JSON.stringify(payload);
  assert.equal(Buffer.byteLength(body), MAX_BYTES);
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => new Response(body),
  });
  assert.deepEqual(await client.getCloudSongs('synthetic-token'), payload);
  body += ' ';
  await assert.rejects(client.getCloudSongs('synthetic-token'), {
    code: 'RESPONSE_TOO_LARGE', retryable: false,
  });
  await assert.rejects(client.heartbeat('synthetic-token'), { code: 'RESPONSE_TOO_LARGE' });
});

test('oversized song streams stop at the budget and do not invite a retry', async () => {
  let readCalls = 0;
  let cancelled = false;
  let released = false;
  const chunk = new Uint8Array(1024 * 1024);
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => ({
      status: 200, ok: true,
      body: { getReader: () => ({
        read: async () => { readCalls += 1; return { done: false, value: chunk }; },
        cancel: async () => { cancelled = true; },
        releaseLock: () => { released = true; },
      }) },
      text() { assert.fail('the unbounded text reader must not be used for songs'); },
    }),
  });
  await assert.rejects(client.getCloudSongs('synthetic-token'), {
    code: 'RESPONSE_TOO_LARGE', retryable: false,
  });
  assert.equal(readCalls, 9);
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test('song transport checks UTF-8 byte length for text-only injected responses', async () => {
  const body = JSON.stringify({ songs: [{ title: '曲'.repeat(3 * 1024 * 1024) }] });
  assert.ok(body.length < MAX_BYTES);
  assert.ok(Buffer.byteLength(body) > MAX_BYTES);
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => body }),
  });
  await assert.rejects(client.getCloudSongs('synthetic-token'), {
    code: 'RESPONSE_TOO_LARGE', retryable: false,
  });
});

test('bounded song decoding preserves Response.text BOM and split UTF-8 behavior', async () => {
  const payload = { songs: [{ title: '歌曲😀' }] };
  const bytes = Buffer.from(`\uFEFF${JSON.stringify(payload)}`);
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 2) {
          controller.enqueue(bytes.subarray(offset, offset + 2));
        }
        controller.close();
      },
    })),
  });
  assert.deepEqual(await client.getCloudSongs('synthetic-token'), payload);
});
