'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureAudioMediaCors } = require('../../src/electron/audio-media-cors');

test('PCM decoding access is limited to supported media CDN responses for the authorized main frame', () => {
  let handler;
  const frame = { url: 'http://127.0.0.1:3456/admin' };
  const window = { isDestroyed: () => false, webContents: { id: 7, mainFrame: frame } };
  configureAudioMediaCors({ webRequest: { onHeadersReceived: (_filter, callback) => { handler = callback; } } },
    { getMainWindow: () => window, getDesktopBaseUrl: () => 'http://127.0.0.1:3456' });
  const request = { url: 'https://m1.music.126.net/song.mp3', webContentsId: 7, frame, resourceType: 'media', method: 'GET',
    responseHeaders: { 'Content-Type': ['audio/mpeg'], 'access-control-allow-origin': ['*'] } };
  function read(details) { let result; handler(details, value => { result = value; }); return result; }
  assert.deepEqual(read(request).responseHeaders, { 'Content-Type': ['audio/mpeg'], 'Access-Control-Allow-Origin': ['http://127.0.0.1:3456'] });
  for (const change of [{ url: 'https://evil-music.126.net/song.mp3' }, { webContentsId: 8 },
    { frame: { ...frame } }, { resourceType: 'xhr' }, { method: 'POST' }]) assert.deepEqual(read({ ...request, ...change }), {});
  frame.url = 'https://example.com/admin';
  assert.deepEqual(read(request), {});
});
