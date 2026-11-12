'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routes } = require('../../src/server/routes/music-routes');
const { createPublicError } = require('../../src/shared/public-error');

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

test('encrypted streams keep same-origin relative URLs without exposing the session token', async () => {
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
    assert.equal(resolved.searchParams.has('token'), false);
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

test('stream failures map invalid parameters to 400 and known provider failures to 501', async () => {
  const invalid = await resolveStream({
    resolvePlayableUrl: () => {
      throw Object.assign(new Error('internal validation detail'), { statusCode: 400 });
    },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.ok, false);
  assert.doesNotMatch(invalid.payload.error, /internal validation detail/);

  const providerError = createPublicError('synthetic playback entitlement failure', 501);
  const unavailable = await resolveStream({
    resolvePlayableUrl: () => {
      throw providerError;
    },
  });
  assert.equal(unavailable.status, 501);
  assert.equal(unavailable.payload.ok, false);
  assert.equal(unavailable.payload.error, providerError.message);

  const missingTrack = await resolveStream({ body: {}, resolvePlayableUrl: () => assert.fail('no provider call') });
  assert.equal(missingTrack.status, 501);
  assert.equal(missingTrack.calls.length, 0);
});
