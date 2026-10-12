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
    getBilibiliAuthState: async () => state,
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

test('random request identity only changes for a different account or a completed logout', async (t) => {
  let state = { loggedIn: true, uid: 42 };
  const auth = controller({
    getBilibiliAuthState: async () => state,
    replaceBilibiliCookieHeader: async (_directory, uid) => (state = { loggedIn: true, uid }),
    logoutBilibiliAccount: async () => (state = { loggedIn: false, uid: 0 }),
  }, async (options) => ({ state: await options.auth.getBilibiliAuthState() }));
  t.after(() => auth.dispose());
  assert.equal((await auth.getBilibiliRequestIdentity()).uid, 42);
  assert.equal(auth.getBilibiliIdentityRevision(), 0);
  await auth.loginBilibiliAccount();
  await auth.replaceBilibiliCookieHeader(42);
  assert.equal(auth.getBilibiliIdentityRevision(), 0, 'same-account login and Cookie replacement preserve requests');
  await auth.replaceBilibiliCookieHeader(84);
  await auth.replaceBilibiliCookieHeader(42);
  assert.equal(auth.getBilibiliIdentityRevision(), 2, 'switching away and back is still a real change');
  await auth.logoutBilibiliAccount();
  state = { loggedIn: true, uid: 42 };
  await auth.loginBilibiliAccount();
  assert.equal(auth.getBilibiliIdentityRevision(), 4, 'logout ends the old identity even when the same user logs in');
});

test('random identity waits for Cookie replacement without changing normal auth-state reads', async (t) => {
  let state = { loggedIn: true, uid: 42 };
  const replacing = Promise.withResolvers();
  const release = Promise.withResolvers();
  const auth = controller({
    getBilibiliAuthState: async () => state,
    async replaceBilibiliCookieHeader() {
      state = { loggedIn: false, uid: 0 };
      replacing.resolve();
      await release.promise;
      return (state = { loggedIn: true, uid: 42 });
    },
  });
  t.after(() => { release.resolve(); auth.dispose(); });
  await auth.getBilibiliRequestIdentity();
  const replacement = auth.replaceBilibiliCookieHeader('same-account');
  await replacing.promise;
  let settled = false;
  const identity = auth.getBilibiliRequestIdentity().then((value) => { settled = true; return value; });
  assert.equal((await auth.getBilibiliAuthState()).loggedIn, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release.resolve();
  await replacement;
  assert.equal((await identity).uid, 42);
  assert.equal(auth.getBilibiliIdentityRevision(), 0);
});

test('a delayed identity read cannot erase an account switch away and back', async (t) => {
  let state = { loggedIn: true, uid: 42 };
  let delayed = false;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const auth = controller({
    async getBilibiliAuthState() {
      const snapshot = state;
      if (delayed) { delayed = false; entered.resolve(); await release.promise; }
      return snapshot;
    },
    replaceBilibiliCookieHeader: async (_directory, uid) => (state = { loggedIn: true, uid }),
  });
  t.after(() => { release.resolve(); auth.dispose(); });
  await auth.getBilibiliRequestIdentity();
  delayed = true;
  const identity = auth.getBilibiliRequestIdentity();
  await entered.promise;
  await auth.replaceBilibiliCookieHeader(84);
  await auth.replaceBilibiliCookieHeader(42);
  release.resolve();
  assert.equal((await identity).uid, 42);
  assert.equal(auth.getBilibiliIdentityRevision(), 2);
});

test('an aborted login auth read cannot overwrite the replacement account identity', async (t) => {
  let state = { loggedIn: true, uid: 42 };
  const read = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const loginOpened = Promise.withResolvers();
  const loginDone = Promise.withResolvers();
  let delayRead = false;
  const auth = controller({
    async getBilibiliAuthState() {
      const snapshot = state;
      if (delayRead) { delayRead = false; entered.resolve(); await read.promise; }
      return snapshot;
    },
    replaceBilibiliCookieHeader: async (_directory, uid) => (state = { loggedIn: true, uid }),
  }, (options) => {
    loginOpened.resolve(options);
    options.signal.addEventListener('abort', () => loginDone.resolve({ state }), { once: true });
    return loginDone.promise;
  });
  t.after(() => { read.resolve(); loginDone.resolve({ state }); auth.dispose(); });
  await auth.getBilibiliRequestIdentity();
  const login = auth.loginBilibiliAccount();
  const options = await loginOpened.promise;
  delayRead = true;
  const pending = options.auth.getBilibiliAuthState();
  await entered.promise;
  await auth.replaceBilibiliCookieHeader(84);
  await login;
  read.resolve();
  await pending;
  assert.equal(auth.getBilibiliIdentityRevision(), 1);
  assert.equal((await auth.getBilibiliRequestIdentity()).uid, 84);
  assert.equal(auth.getBilibiliIdentityRevision(), 1);
});
