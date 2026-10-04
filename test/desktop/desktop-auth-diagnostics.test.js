'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

function controller(auth, login) {
  const filename = require.resolve('../../src/electron/desktop-auth-controller');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      module,
      AbortController,
      require(request) {
        if (request === './bilibili-auth') return auth;
        if (request === './bilibili-login-window' && login) return { openBilibiliLoginWindow: login };
        if (request === './music-auth-manager' || request === './music-login-window') return {};
        return localRequire(request);
      },
    },
    { filename },
  );
  return module.exports.createDesktopAuthController({
    getDataDir: () => 'synthetic-data',
    getMainWindow: () => null,
    writeLog() {},
  });
}

test('Bilibili session revision changes as soon as logout or same-account login starts', async () => {
  const logout = Promise.withResolvers();
  const state = { loggedIn: true, uid: 42 };
  const auth = controller(
    {
      replaceBilibiliCookieHeader: async () => state,
      logoutBilibiliAccount: () => logout.promise,
    },
    async () => ({ state }),
  );
  assert.equal(auth.getBilibiliSessionRevision(), 0);
  await auth.replaceBilibiliCookieHeader('synthetic-cookie');
  const original = auth.getBilibiliSessionRevision();
  const pendingLogout = auth.logoutBilibiliAccount();
  assert.equal(auth.getBilibiliSessionRevision(), original + 1);
  logout.resolve({ loggedIn: false });
  await pendingLogout;
  const pendingLogin = auth.loginBilibiliAccount();
  assert.equal(auth.getBilibiliSessionRevision(), original + 2);
  assert.equal((await pendingLogin).state.uid, 42);
  auth.dispose();
});

test('desktop credential restore/import/logout diagnostics preserve operation results and omit secrets', async (t) => {
  const lines = [];
  t.mock.method(console, 'info', (line) => lines.push(line));
  const snapshot = { savedAt: '2026-09-17T00:00:00Z', cookieCount: 3 };
  const state = {
    loggedIn: true,
    uid: 912345678,
    hasSessdata: true,
    keyCookieNames: ['SESSDATA', 'bili_jct'],
    cookieHeader: 'synthetic-secret',
  };
  const loggedOut = { loggedIn: false };
  const auth = controller({
    restoreBilibiliCookieSnapshot: async () => snapshot,
    replaceBilibiliCookieHeader: async (dataDir, cookieHeader) => {
      assert.equal(dataDir, 'synthetic-data');
      assert.equal(cookieHeader, 'synthetic-secret');
      return state;
    },
    logoutBilibiliAccount: async () => loggedOut,
  });
  assert.equal(await auth.restoreBilibiliCookieSnapshot(), snapshot);
  assert.equal(await auth.replaceBilibiliCookieHeader('synthetic-secret'), state);
  assert.equal(await auth.logoutBilibiliAccount(), loggedOut);
  const events = lines.map((line) => JSON.parse(line.split('[Bilibili][Diagnostic] ')[1]));
  assert.deepEqual(
    events.map((entry) => entry.event),
    [
      'credentials-restore',
      'credentials-import-start',
      'credentials-import-complete',
      'logout-start',
      'logout-complete',
    ],
  );
  assert.equal(events[2].loggedIn, true);
  assert.equal(events[4].loggedIn, false);
  assert.doesNotMatch(lines.join('\n'), /synthetic-secret|912345678/);
});

test('failed credential operations still reject and produce safe failure events', async (t) => {
  const lines = [];
  t.mock.method(console, 'info', (line) => lines.push(line));
  const failure = new Error('SESSDATA=synthetic-secret');
  const auth = controller({
    replaceBilibiliCookieHeader: async () => {
      throw failure;
    },
    logoutBilibiliAccount: async () => {
      throw failure;
    },
  });
  await assert.rejects(auth.replaceBilibiliCookieHeader('synthetic-secret'), (error) => error === failure);
  await assert.rejects(auth.logoutBilibiliAccount(), (error) => error === failure);
  assert.match(lines.join('\n'), /credentials-import-failed/);
  assert.match(lines.join('\n'), /logout-failed/);
  assert.doesNotMatch(lines.join('\n'), /synthetic-secret/);
});
