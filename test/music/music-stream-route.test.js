'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routes } = require('../../src/server/routes/music-routes');

const TRACK = { id: 'qq:mid', source: 'qq', sourceTrackId: 'mid', title: 'Synthetic Song' };

async function resolveStream({ body = { track: TRACK }, sessionToken = 'session-token', resolvePlayableUrl }) {
  const calls = [];
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.payload = JSON.parse(text);
    },
  };
  const context = {
    sessionToken,
    music: {
      registry: {
        get(source) {
          return {
            async resolvePlayableUrl(track, options) {
              calls.push({ source, track, options });
              return resolvePlayableUrl(track, options);
            },
          };
        },
      },
    },
  };
  await routes['POST /api/music/resolve-stream'](context, { body: async () => body }, response);
  return { ...response, calls };
}

test('encrypted streams receive the session token only on a same-origin relative URL', async () => {
  for (const url of [
    '/api/music/qq-encrypted-stream?id=abc',
    'https://cdn.example.test/api/music/qq-encrypted-stream?id=abc',
  ]) {
    const { status, payload } = await resolveStream({ resolvePlayableUrl: () => ({ encrypted: true, url }) });
    assert.equal(status, 200);
    assert.match(payload.data.url, /^\/(?!\/)/, `${url} must not keep an external origin`);
    const resolved = new URL(payload.data.url, 'http://lira.local');
    assert.equal(resolved.pathname, '/api/music/qq-encrypted-stream');
    assert.equal(resolved.searchParams.get('id'), 'abc');
    assert.equal(resolved.searchParams.get('token'), 'session-token');
  }
});

test('plain streams and sessions without a token are returned without credentials', async () => {
  const plain = await resolveStream({
    resolvePlayableUrl: () => ({ url: 'https://cdn.example.test/song.flac?vkey=upstream' }),
  });
  assert.equal(plain.payload.data.url, 'https://cdn.example.test/song.flac?vkey=upstream');

  const tokenless = await resolveStream({
    sessionToken: '',
    resolvePlayableUrl: () => ({ encrypted: true, url: '/api/music/qq-encrypted-stream?id=abc' }),
  });
  assert.equal(tokenless.payload.data.url, '/api/music/qq-encrypted-stream?id=abc');
});

test('stream resolution forwards only an explicit refresh and the selected quality', async () => {
  for (const [body, expected] of [
    [{ track: TRACK, forceRefresh: true, quality: 'lossless' }, { forceRefresh: true, quality: 'lossless' }],
    [{ track: TRACK, forceRefresh: 'true' }, { forceRefresh: false, quality: '' }],
  ]) {
    const { calls } = await resolveStream({ body, resolvePlayableUrl: () => ({ url: 'https://cdn.example.test/a.mp3' }) });
    assert.equal(calls[0].source, 'qq');
    assert.equal(calls[0].track.sourceTrackId, 'mid');
    assert.deepEqual({ ...calls[0].options }, expected);
  }
});

test('stream failures map invalid parameters to 400 and provider failures to 501', async () => {
  const invalid = await resolveStream({
    resolvePlayableUrl: () => {
      throw Object.assign(new Error('internal validation detail'), { statusCode: 400 });
    },
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.payload, { ok: false, error: 'Invalid request parameters.' });

  const unavailable = await resolveStream({
    resolvePlayableUrl: () => {
      throw new Error('没有该歌曲的完整播放或试听权益');
    },
  });
  assert.equal(unavailable.status, 501);
  assert.equal(unavailable.payload.ok, false);
  assert.match(unavailable.payload.error, /试听权益/);

  const missingTrack = await resolveStream({ body: {}, resolvePlayableUrl: () => assert.fail('no provider call') });
  assert.equal(missingTrack.status, 501);
  assert.equal(missingTrack.calls.length, 0);
});
