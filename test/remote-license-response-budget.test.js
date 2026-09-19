'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');

for (const { label, request, maxBytes } of [
  { label: 'activation', request: (client) => client.activate({}), maxBytes: 1024 * 1024 },
  { label: 'gift recovery', request: (client) => client.getGiftEvents(0, 200, 'fixture'), maxBytes: 512 * 1024 },
  { label: 'gift history', request: (client) => client.getGiftHistory(null, 'fixture'), maxBytes: 512 * 1024 },
  { label: 'gift card profiles', request: (client) => client.getGiftCardProfiles(null, 'fixture'), maxBytes: 512 * 1024 },
]) {
  test(`${label} stops reading and cancels a stream as soon as its existing byte budget is exceeded`, async () => {
    let readCalls = 0;
    let cancelled = false;
    let released = false;
    const chunk = new Uint8Array(64 * 1024);
    const client = createRemoteLicenseClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        body: { getReader: () => ({
          read: async () => { readCalls += 1; return { done: false, value: chunk }; },
          cancel: async () => { cancelled = true; },
          releaseLock: () => { released = true; },
        }) },
        text: async () => ' '.repeat(maxBytes + 1),
      }),
    });
    await assert.rejects(request(client), { code: 'RESPONSE_TOO_LARGE', status: 200, retryable: true });
    assert.equal(readCalls, maxBytes / chunk.byteLength + 1);
    assert.equal(cancelled, true);
    assert.equal(released, true);
  });
}

test('ordinary JSON streaming accepts the exact byte boundary and preserves split UTF-8 and BOM decoding', async () => {
  const payload = { title: '歌曲😀', padding: '' };
  payload.padding = 'x'.repeat(1024 * 1024 - Buffer.byteLength(`\uFEFF${JSON.stringify(payload)}`));
  const bytes = Buffer.from(`\uFEFF${JSON.stringify(payload)}`);
  assert.equal(bytes.length, 1024 * 1024);
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length;) {
          const end = offset + (offset < 32 ? 2 : 1024);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
        }
        controller.close();
      },
    })),
  });
  assert.deepEqual(await client.activate({}), payload);
});

test('oversized error responses preserve status, retry policy and retry-after metadata', async () => {
  for (const status of [401, 429, 503]) {
    let cancelled = false;
    let chunks = 0;
    const client = createRemoteLicenseClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) {
          if (chunks++ === 3) controller.close();
          else controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel() { cancelled = true; },
      }), { status, headers: { 'retry-after': '12' } }),
    });
    await assert.rejects(client.profile('fixture'), {
      code: 'RESPONSE_TOO_LARGE', status, retryable: status !== 401, retryAfterMs: 12000,
    });
    assert.equal(cancelled, true);
  }
});

test('SSE error responses cancel at their existing 64 KiB budget and retain the HTTP fallback', async () => {
  let readCalls = 0;
  let cancelled = false;
  let released = false;
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => ({
      status: 503,
      ok: false,
      headers: new Headers({ 'retry-after': '21' }),
      body: { getReader: () => ({
        read: async () => { readCalls += 1; return { done: false, value: new Uint8Array(64 * 1024) }; },
        cancel: async () => { cancelled = true; },
        releaseLock: () => { released = true; },
      }) },
      text: async () => ' '.repeat(64 * 1024 + 1),
    }),
  });
  await assert.rejects(client.watchCloudStateChanges('fixture'), {
    code: 'HTTP_503', status: 503, retryable: true, retryAfterMs: 21000,
  });
  assert.equal(readCalls, 2);
  assert.equal(cancelled, true);
  assert.equal(released, true);
});
