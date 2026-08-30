'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function loadAuthManager(cookies) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const modulePath = require.resolve('../src/electron/auth-manager');
  const fakeElectron = {
    safeStorage: { isEncryptionAvailable: () => false },
    session: {
      fromPartition: () => ({
        cookies: { get: async () => cookies },
      }),
    },
  };

  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return fakeElectron;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    delete require.cache[modulePath];
    Module._load = originalLoad;
  }
}

function qqCookie(name, value, domain = '.qq.com') {
  return { name, value, domain };
}

test('QQ auth recognizes every non-empty QQ Music credential', async () => {
  for (const name of ['qqmusic_key', 'qm_keyst']) {
    const authManager = loadAuthManager([qqCookie(name, 'token')]);
    const state = await authManager.getMusicAuthState('qq', 'test-data');
    assert.equal(state.loggedIn, true, name);
  }
});

test('QQ auth does not treat generic QQ session cookies as music login', async () => {
  for (const name of ['p_skey', 'skey']) {
    const authManager = loadAuthManager([
      qqCookie(name, 'token'),
      qqCookie('uin', 'o123456'),
    ]);
    const state = await authManager.getMusicAuthState('qq', 'test-data');
    assert.equal(state.loggedIn, false, name);
  }
});

test('QQ auth ignores empty auth cookies and unrelated key cookies', async () => {
  const authManager = loadAuthManager([
    qqCookie('qqmusic_key', ''),
    qqCookie('qm_keyst', ''),
    qqCookie('p_skey', ''),
    qqCookie('skey', ''),
    qqCookie('uin', 'o123456'),
  ]);
  const state = await authManager.getMusicAuthState('qq', 'test-data');
  assert.equal(state.loggedIn, false);
  assert.deepEqual(state.keyCookieNames, [
    'uin',
    'qqmusic_key',
    'qm_keyst',
    'p_skey',
    'skey',
  ]);
});

test('QQ auth still filters auth cookies outside the allowed domains', async () => {
  const authManager = loadAuthManager([
    qqCookie('qqmusic_key', 'token', '.evil.example'),
  ]);
  const state = await authManager.getMusicAuthState('qq', 'test-data');
  assert.equal(state.loggedIn, false);
  assert.equal(state.cookieCount, 0);
});
