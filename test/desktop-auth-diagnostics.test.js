'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

function controller(auth) {
  const filename = require.resolve('../src/electron/desktop-auth-controller');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require(request) {
      if (request === './bilibili-auth') return auth;
      if (request === './auth-manager' || request === './login-window') return {};
      return localRequire(request);
    },
  }, { filename });
  return module.exports.createDesktopAuthController({ getDataDir: () => 'synthetic-data' });
}

test('desktop credential restore/import/logout diagnostics preserve operation results and omit secrets', async (t) => {
  const lines = [];
  t.mock.method(console, 'info', (line) => lines.push(line));
  const snapshot = { savedAt: '2026-09-17T00:00:00Z', cookieCount: 3 };
  const state = {
    loggedIn: true, uid: 912345678, hasSessdata: true,
    keyCookieNames: ['SESSDATA', 'bili_jct'], cookieHeader: 'synthetic-secret',
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
  assert.deepEqual(events.map((entry) => entry.event), [
    'credentials-restore', 'credentials-import-start', 'credentials-import-complete',
    'logout-start', 'logout-complete',
  ]);
  assert.equal(events[2].loggedIn, true);
  assert.equal(events[4].loggedIn, false);
  assert.doesNotMatch(lines.join('\n'), /synthetic-secret|912345678/);
});

test('failed credential operations still reject and produce safe failure events', async (t) => {
  const lines = [];
  t.mock.method(console, 'info', (line) => lines.push(line));
  const failure = new Error('SESSDATA=synthetic-secret');
  const auth = controller({
    replaceBilibiliCookieHeader: async () => { throw failure; },
    logoutBilibiliAccount: async () => { throw failure; },
  });
  await assert.rejects(auth.replaceBilibiliCookieHeader('synthetic-secret'), (error) => error === failure);
  await assert.rejects(auth.logoutBilibiliAccount(), (error) => error === failure);
  assert.match(lines.join('\n'), /credentials-import-failed/);
  assert.match(lines.join('\n'), /logout-failed/);
  assert.doesNotMatch(lines.join('\n'), /synthetic-secret/);
});
