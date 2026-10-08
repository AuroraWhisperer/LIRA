'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAuthState } = require('../../src/music/auth-state');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');

test('music auth projection retains status fields and excludes credentials', () => {
  assert.deepEqual(sanitizeAuthState(null), {
    loggedIn: false,
    cookieCount: 0,
    keyCookieNames: [],
    encryptedSnapshotExists: false,
    lastSavedAt: '',
  });
  assert.deepEqual(
    sanitizeAuthState({
      loggedIn: 1,
      cookieCount: '3',
      keyCookieNames: ['MUSIC_U'],
      encryptedSnapshotExists: true,
      lastSavedAt: 'fixture-time',
      cookie: 'synthetic-secret',
      accessToken: 'synthetic-token',
    }),
    {
      loggedIn: true,
      cookieCount: 3,
      keyCookieNames: ['MUSIC_U'],
      encryptedSnapshotExists: true,
      lastSavedAt: 'fixture-time',
    },
  );
  assert.equal(sanitizeAuthState({ cookieCount: 'invalid' }).cookieCount, 0);
  assert.deepEqual(sanitizeAuthState({ keyCookieNames: 'invalid' }).keyCookieNames, []);
});

test('provider health results retain login status without exposing credentials on success or failure', async (t) => {
  let available = true;
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: available ? 200 : 503 }));
  for (const [source, Provider] of [['qq', QQMusicProvider], ['netease', NeteaseMusicProvider]]) {
    const provider = new Provider({
      getAuthState(platform) {
        assert.equal(platform, source);
        return { loggedIn: true, cookie: 'synthetic-secret', accessToken: 'synthetic-token' };
      },
    });
    for (const reachable of [true, false]) {
      available = reachable;
      const result = await provider.healthCheck();
      assert.equal(result.source, source);
      assert.equal(result.ok, reachable);
      assert.equal(result.status, reachable ? 'logged-in' : 'api-error');
      assert.equal(result.auth.loggedIn, true);
      assert.equal('cookie' in result.auth, false);
      assert.equal('accessToken' in result.auth, false);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|synthetic-token/);
    }
  }
});
