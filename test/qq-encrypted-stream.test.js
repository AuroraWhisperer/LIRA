'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRange,
  validateMediaUrl,
  serveQQEncryptedStream,
} = require('../src/music/qq-encrypted-stream');

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
