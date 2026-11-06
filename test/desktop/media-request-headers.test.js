'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');

test('one session listener retains music and Bilibili rules across repeated setup', () => {
  const registrations = [];
  const session = {
    webRequest: { onBeforeSendHeaders: (...args) => registrations.push(args) },
  };
  configureMediaRequestHeaders(session);
  configureMediaRequestHeaders(session);
  assert.equal(registrations.length, 1);
  const [, handler] = registrations[0];
  for (const [host, expected] of [
    ['m701.music.126.net', { Referer: 'https://music.163.com/' }],
    ['ws.stream.qqmusic.qq.com', { Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' }],
    ['i0.hdslb.com', { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com' }],
    ['example.com', {}],
    ['evilbilibili.com', {}],
  ]) {
    let calls = 0;
    handler({ url: `https://${host}/media`, requestHeaders: { Accept: '*/*' } }, (result) => {
      calls += 1;
      assert.deepEqual(result.requestHeaders, { Accept: '*/*', ...expected });
    });
    assert.equal(calls, 1);
  }
  const original = {
    referer: 'https://original.test/',
    origin: 'https://original.test',
  };
  handler({ url: 'https://y.qq.com/song', requestHeaders: original }, (result) => {
    assert.deepEqual(result.requestHeaders, original);
    assert.notEqual(result.requestHeaders, original);
  });
});
