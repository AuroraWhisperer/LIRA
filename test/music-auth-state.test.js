'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAuthState } = require('../src/music/auth-state');

test('music auth projection retains status fields and excludes credentials', () => {
  for (const owner of ['netease-mappers', 'qq-provider-utils']) {
    assert.equal(require(`../src/music/providers/${owner}`).sanitizeAuthState, sanitizeAuthState);
  }
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
