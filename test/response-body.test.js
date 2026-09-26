'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readResponseBytes, readResponseText } = require('../src/shared/response-body');

const tooLarge = () => Object.assign(new Error('Response exceeds budget.'), { code: 'TOO_LARGE' });

test('response budget cancels a chunked body before consuming the remaining stream', async () => {
  let pulls = 0;
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(4));
      if (pulls === 20) controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }));
  await assert.rejects(readResponseBytes(response, 8, tooLarge), { code: 'TOO_LARGE' });
  assert.equal(pulls, 3);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test('response budget rejects an oversized declaration and releases the unread body', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { 'content-length': '9' } });
  await assert.rejects(readResponseBytes(response, 8, tooLarge), { code: 'TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('response text preserves split UTF-8, strips BOM and accepts the exact byte budget', async () => {
  const bytes = Buffer.from('\uFEFF中文');
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 4));
      controller.enqueue(bytes.subarray(4));
      controller.close();
    },
  }));
  assert.equal(await readResponseText(response, bytes.length, tooLarge), '中文');
});

test('response budget propagates stream failures and validates fixture responses', async () => {
  const failure = new Error('disconnected');
  const response = new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
  await assert.rejects(readResponseText(response, 10, tooLarge), failure);
  await assert.rejects(readResponseBytes({ text: async () => '中文' }, 5, tooLarge), { code: 'TOO_LARGE' });
  assert.deepEqual(await readResponseBytes({ arrayBuffer: async () => Uint8Array.of(1, 2) }, 2, tooLarge), Buffer.from([1, 2]));
});
