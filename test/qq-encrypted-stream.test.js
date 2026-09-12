'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Writable } = require('node:stream');
const {
  parseRange,
  validateMediaUrl,
  serveQQEncryptedStream,
} = require('../src/music/qq-encrypted-stream');

function streamFixture(t, write = (_chunk, _encoding, callback) => callback()) {
  const ciphers = [];
  const module = { exports: {} };
  const filename = require.resolve('../src/music/qq-encrypted-stream');
  vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module'])(
    (id) => id === '@clamber_l/crypto' ? {
      ready: Promise.resolve(),
      QMC2: class {
        constructor() { this.offsets = []; this.freed = 0; ciphers.push(this); }
        decrypt(buffer, offset) { this.offsets.push(offset); }
        free() { this.freed += 1; }
      },
    } : require(id), module,
  );
  const req = Object.assign(new EventEmitter(), { headers: {} });
  const res = new Writable({ highWaterMark: 1, write });
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; res.headersSent = true; };
  t.after(() => res.destroy());
  const record = { url: 'https://isure.stream.qqmusic.qq.com/a.mflac', expiresAt: Date.now() + 60000 };
  return { req, res, ciphers, run: (fetchImpl) => module.exports.serveQQEncryptedStream(record, req, res, { fetchImpl }) };
}

test('QQ stream honors backpressure and cancels a blocked stream on downstream close', async (t) => {
  const f = streamFixture(t, () => {});
  let pulls = 0;
  let cancelled = 0;
  let signal;
  const body = new ReadableStream({
    pull(controller) { pulls += 1; controller.enqueue(Buffer.alloc(65536)); },
    cancel() { cancelled += 1; },
  });
  const running = f.run(async (_url, options) => { signal = options.signal; return new Response(body); });
  await new Promise(setImmediate);
  assert.ok(pulls > 0 && pulls < 8, `bounded read ahead: ${pulls}`);
  f.res.destroy();
  await running;
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, 1);
  assert.equal(f.ciphers[0].freed, 1);
  assert.equal(f.req.listenerCount('aborted'), 0);
});

test('QQ stream aborts an upstream fetch before headers when the client leaves', async (t) => {
  const f = streamFixture(t);
  let signal;
  const running = f.run((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  f.req.emit('aborted');
  await running;
  assert.equal(signal.aborted, true);
  assert.equal(f.ciphers.length, 0);
  assert.equal(f.res.headersSent, undefined);
});

for (const contentLength of [undefined, '1']) {
  test(`QQ stream enforces actual byte limit with ${contentLength ?? 'missing'} length`, async (t) => {
    let written = 0;
    const f = streamFixture(t, (chunk, _encoding, callback) => { written += chunk.length; callback(); });
    let cancelled = 0;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(Buffer.alloc(1024 * 1024)); },
      cancel() { cancelled += 1; },
    });
    await f.run(async () => new Response(body, { headers: contentLength ? { 'content-length': contentLength } : {} }));
    assert.equal(written, 64 * 1024 * 1024);
    assert.equal(f.res.destroyed, true);
    assert.equal(cancelled, 1);
    assert.equal(f.ciphers[0].freed, 1);
  });
}

test('QQ stream releases rejected bodies and preserves range decrypt offsets', async (t) => {
  for (const headers of [{ 'content-length': String(65 * 1024 * 1024) }]) {
    const f = streamFixture(t);
    let cancelled = 0;
    await f.run(async () => new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { headers }));
    assert.equal(f.res.status, 502);
    assert.equal(cancelled, 1);
    assert.equal(f.ciphers.length, 0);
  }
  const f = streamFixture(t);
  f.req.headers.range = 'bytes=100-105';
  await f.run(async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=100-105');
    return new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.alloc(3)); c.enqueue(Buffer.alloc(3)); c.close(); } }), {
      status: 206, headers: { 'content-range': 'bytes 100-105/200' },
    });
  });
  assert.deepEqual(f.ciphers[0].offsets, [100, 103]);
  assert.equal(f.res.status, 206);
  assert.equal(f.res.headers['content-range'], 'bytes 100-105/200');
  assert.equal(f.res.writableFinished, true);
  assert.equal(f.ciphers[0].freed, 1);
});

test('QQ encrypted stream validates byte ranges and CDN hosts', () => {
  assert.deepEqual(parseRange('bytes=262144-327679'), {
    start: 262144,
    end: 327679,
  });
  assert.deepEqual(parseRange('bytes=10-'), { start: 10, end: null });
  assert.equal(parseRange('items=0-1'), null);
  assert.equal(
    validateMediaUrl('https://isure.stream.qqmusic.qq.com/a.mflac').hostname,
    'isure.stream.qqmusic.qq.com',
  );
  assert.throws(
    () => validateMediaUrl('https://example.test/a.mflac'),
    /不在允许的 CDN/,
  );
});

test('QQ encrypted stream rejects expired sessions before contacting upstream', async () => {
  let called = false;
  const response = {
    writeHead() {},
    end(body) {
      this.body = body;
    },
    get headersSent() {
      return false;
    },
  };
  await serveQQEncryptedStream(
    {
      url: 'https://isure.stream.qqmusic.qq.com/a.mflac',
      ekey: 'not-used',
      expiresAt: Date.now() - 1,
    },
    { headers: {} },
    response,
    {
      fetchImpl: async () => {
        called = true;
      },
    },
  );
  assert.equal(called, false);
  assert.match(response.body, /过期/);
});
