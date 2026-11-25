'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAuthState } = require('../../src/music/auth-state');
const { createMusicProviderRegistry } = require('../../src/music/provider-registry');

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

test('provider login checks read the session and health reports include sanitized backup metadata', async (t) => {
  let available = true;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 200, result: { songCount: 0 } }, {
    status: available ? 200 : 503,
  }));
  for (const source of ['qq', 'netease']) {
    const reads = [];
    const provider = createMusicProviderRegistry({
      getSessionState(platform) {
        reads.push(['session', platform]);
        return { loggedIn: true };
      },
      getAuthState(platform) {
        reads.push(['full', platform]);
        return { loggedIn: true, encryptedSnapshotExists: true, lastSavedAt: 'fixture-time',
          cookie: 'synthetic-secret', accessToken: 'synthetic-token' };
      },
      getCookieHeader(platform) { reads.push(['header', platform]); return ''; },
    }).get(source);
    await provider.requireLogin();
    assert.deepEqual(reads.splice(0), [['session', source]]);
    for (const reachable of [true, false]) {
      available = reachable;
      const result = await provider.healthCheck();
      assert.equal(result.source, source);
      assert.equal(result.ok, reachable);
      assert.equal(result.status, reachable ? 'logged-in' : 'api-error');
      assert.equal(result.auth.loggedIn, true);
      assert.equal(result.auth.encryptedSnapshotExists, true);
      assert.equal(result.auth.lastSavedAt, 'fixture-time');
      assert.deepEqual(reads.splice(0), [['full', source], ['header', source]]);
      assert.equal('cookie' in result.auth, false);
      assert.equal('accessToken' in result.auth, false);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|synthetic-token/);
    }
  }
});

test('only QQ accepts a compatible web credential when the session check fails', async () => {
  const registry = createMusicProviderRegistry({
    getSessionState() { throw new Error('session unavailable'); },
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: source => source === 'qq' ? 'p_skey=fixture' : 'MUSIC_U=fixture',
  });
  await registry.get('qq').requireLogin();
  await assert.rejects(registry.get('netease').requireLogin(), { statusCode: 501 });
});
