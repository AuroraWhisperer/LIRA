'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const { readResponseBytes } = require('../src/shared/response-body');

const tooLarge = () => Object.assign(new Error('Response exceeds budget.'), { code: 'TOO_LARGE' });

test('response reader bounds allocations and copying for one-byte chunks', async (t) => {
  const length = 65536;
  const byte = Uint8Array.of(0x61);
  let emitted = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (emitted++ < length) controller.enqueue(byte);
      else controller.close();
    },
  }, { highWaterMark: 0 }));
  let allocations = 0;
  let allocatedBytes = 0;
  let copiedBytes = 0;
  const mocks = [];
  for (const name of ['from', 'alloc', 'allocUnsafe']) {
    const original = Buffer[name];
    mocks.push(t.mock.method(Buffer, name, function (...args) {
      const result = original.apply(this, args);
      allocations += 1;
      allocatedBytes += result.length;
      if (name === 'from') copiedBytes += result.length;
      return result;
    }));
  }
  const copy = Buffer.prototype.copy;
  mocks.push(t.mock.method(Buffer.prototype, 'copy', function (...args) {
    const result = copy.apply(this, args);
    copiedBytes += result;
    return result;
  }));
  const set = Buffer.prototype.set;
  mocks.push(t.mock.method(Buffer.prototype, 'set', function (source, offset) {
    copiedBytes += source.byteLength;
    return set.call(this, source, offset);
  }));
  let bytes;
  try {
    bytes = await readResponseBytes(response, length, tooLarge);
  } finally {
    for (const mock of mocks) mock.mock.restore();
  }
  assert.equal(bytes.length, length);
  assert.ok(bytes.every((value) => value === 0x61));
  t.diagnostic(`${length} one-byte chunks: ${allocations} allocations, ${allocatedBytes} allocated bytes, ${copiedBytes} copied bytes`);
  assert.ok(allocations <= 32, `${allocations} Buffer objects retained for ${length} bytes`);
  assert.ok(allocatedBytes <= length * 4);
  assert.ok(copiedBytes <= length * 3);
});

test('native fetch can deliver one-byte HTTP chunks to the response reader', async (t) => {
  let consumed;
  const server = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    for (let index = 0; index < 128 && !res.destroyed; index += 1) {
      consumed = Promise.withResolvers();
      res.write('a');
      await consumed.promise;
    }
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    consumed?.resolve();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/tiny-chunks`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const lengths = [];
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      lengths.push(chunk.byteLength);
      controller.enqueue(chunk);
      consumed.resolve();
    },
  }));
  const bytes = await readResponseBytes({ body, headers: response.headers }, 128, tooLarge);
  assert.equal(bytes.toString(), 'a'.repeat(128));
  assert.equal(lengths.length, 128);
  assert.ok(lengths.every((length) => length === 1));
  t.diagnostic(`native fetch: ${lengths.length} chunks, ${lengths.filter((length) => length === 1).length} one-byte chunks`);
});

test('native fetch abort during body consumption releases the reader and closes the upstream', async (t) => {
  const closed = Promise.withResolvers();
  const server = http.createServer((_req, res) => {
    res.on('close', closed.resolve);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.write('partial response');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/incomplete`, { signal: controller.signal });
  const reading = readResponseBytes(response, 1024, tooLarge);
  assert.equal(response.body.locked, true);
  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  await closed.promise;
  assert.equal(response.body.locked, false);
});
