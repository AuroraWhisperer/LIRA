'use strict';

const authManager = require('./music-auth-manager');
const bilibiliAuth = require('./bilibili-auth');
const { openBilibiliLoginWindow } = require('./bilibili-login-window');
const musicLoginWindow = require('./music-login-window');
const { createMusicProviderRegistry } = require('../music/provider-registry');
const { logBilibiliDiagnostic, summarizeAuthState } = require('../bilibili/diagnostics');

function createDesktopAuthController({ BrowserWindow, shell, getMainWindow, getDataDir, writeLog }) {
  let providerRegistry = null;
  let disposed = false;
  let bilibiliIdentity = null;
  let bilibiliIdentityRevision = 0;
  const accounts = new Map();
  const cancelledLogin = () => ({ cancelled: true, snapshot: null, state: { loggedIn: false } });

  function runAccountOperation(key, operation, isLogin = false) {
    if (disposed) return Promise.reject(new Error('AUTH_OPERATION_CANCELLED'));
    if (!accounts.has(key)) accounts.set(key, { generation: 0, tail: Promise.resolve(), login: null });
    const account = accounts.get(key);
    const generation = ++account.generation;
    account.login?.abortController.abort();
    const started = account.tail.then(async () => {
      // A closed window may still be encrypting a captured Cookie snapshot.
      await account.login?.completion.catch(() => {});
      account.login = null;
      if (isLogin) {
        if (disposed || generation !== account.generation) return { completion: Promise.resolve(cancelledLogin()) };
        const abortController = new AbortController();
        const completion = operation(abortController.signal).then(
          (result) => (generation === account.generation && !disposed ? result : cancelledLogin()),
          (error) => {
            if (generation !== account.generation || disposed) return cancelledLogin();
            throw error;
          },
        );
        account.login = { abortController, completion };
        return { completion };
      }
      return operation();
    });
    // Do not hold this queue for the interactive window's lifetime: logout must be able to cancel it.
    account.tail = started.then(
      () => {},
      () => {},
    );
    return started.then((result) => (isLogin ? result.completion : result));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const account of accounts.values()) account.login?.abortController.abort();
  }

  function whenIdle() {
    return Promise.all(
      [...accounts.values()].map(async (account) => {
        await account.tail;
        await account.login?.completion.catch(() => {});
      }),
    );
  }

  function getMusicAuthState(platform) {
    return authManager.getMusicAuthState(platform, getDataDir());
  }

  function getMusicCookieHeader(platform) {
    return authManager.getMusicCookieHeader(platform);
  }

  function getMusicProviderRegistry() {
    if (!providerRegistry) {
      providerRegistry = createMusicProviderRegistry({
        getAuthState: getMusicAuthState,
        getCookieHeader: getMusicCookieHeader,
      });
    }
    return providerRegistry;
  }

  function logoutMusicAccount(platform) {
    platform = authManager.normalizeMusicPlatform(platform);
    return runAccountOperation(platform, () => authManager.logoutMusicAccount(platform, getDataDir()));
  }

  function clearMusicBrowserCache() {
    return authManager.clearMusicBrowserCache();
  }

  async function restoreMusicCookieSnapshots() {
    for (const platform of Object.keys(authManager.MUSIC_LOGIN_CONFIG)) {
      await runAccountOperation(platform, () => authManager.restoreMusicCookieSnapshot(platform, getDataDir()));
    }
  }

  async function loginMusicAccount(platform) {
    platform = authManager.normalizeMusicPlatform(platform);
    writeLog('window', { event: 'create', window: 'music-login', platform });
    try {
      return await runAccountOperation(
        platform,
        (signal) => musicLoginWindow.loginMusicAccount(getMainWindow(), platform, getDataDir(), { signal }),
        true,
      );
    } finally {
      writeLog('window', { event: 'closed', window: 'music-login', platform });
    }
  }

  function getBilibiliAuthState() {
    return bilibiliAuth.getBilibiliAuthState(getDataDir());
  }

  function getBilibiliCookieHeader() {
    return bilibiliAuth.getBilibiliCookieHeader();
  }

  function getBilibiliAccountProfile() {
    return bilibiliAuth.getBilibiliAccountProfile(getDataDir());
  }

  function getBilibiliUid() {
    return bilibiliAuth.getBilibiliUid();
  }

  function getBilibiliSessionRevision() {
    return accounts.get('bilibili')?.generation || 0;
  }

  function observeBilibiliIdentity(state) {
    const identity = state?.loggedIn ? Number(state.uid) || 0 : 0;
    if (bilibiliIdentity !== null && bilibiliIdentity !== identity) bilibiliIdentityRevision += 1;
    bilibiliIdentity = identity;
    return state;
  }

  async function getBilibiliRequestIdentity() {
    while (true) {
      const generation = getBilibiliSessionRevision();
      const revision = bilibiliIdentityRevision;
      // A same-account Cookie import temporarily clears the partition before replacing it.
      await accounts.get('bilibili')?.tail;
      const state = await getBilibiliAuthState();
      if (generation !== getBilibiliSessionRevision() || revision !== bilibiliIdentityRevision) continue;
      observeBilibiliIdentity(state);
      return { loggedIn: state.loggedIn, uid: state.uid };
    }
  }

  async function restoreBilibiliCookieSnapshot() {
    const snapshot = await runAccountOperation('bilibili', async () => {
      const restored = await bilibiliAuth.restoreBilibiliCookieSnapshot(getDataDir());
      observeBilibiliIdentity(await getBilibiliAuthState());
      return restored;
    });
    logBilibiliDiagnostic('credentials-restore', { restored: Boolean(snapshot) });
    return snapshot;
  }

  async function replaceBilibiliCookieHeader(cookieHeader) {
    logBilibiliDiagnostic('credentials-import-start');
    try {
      const state = await runAccountOperation('bilibili', async () =>
        observeBilibiliIdentity(await bilibiliAuth.replaceBilibiliCookieHeader(getDataDir(), cookieHeader)),
      );
      logBilibiliDiagnostic('credentials-import-complete', summarizeAuthState(state));
      return state;
    } catch (error) {
      logBilibiliDiagnostic('credentials-import-failed');
      throw error;
    }
  }

  async function loginBilibiliAccount() {
    writeLog('window', { event: 'create', window: 'bilibili-login' });
    try {
      return await runAccountOperation(
        'bilibili',
        async (signal) => {
          const result = await openBilibiliLoginWindow({
            BrowserWindow,
            shell,
            auth: {
              ...bilibiliAuth,
              async getBilibiliAuthState() {
                const state = await getBilibiliAuthState();
                if (!signal.aborted) observeBilibiliIdentity(state);
                return state;
              },
            },
            mainWindow: getMainWindow(),
            dataDir: getDataDir(),
            writeLog,
            signal,
          });
          if (!signal.aborted) observeBilibiliIdentity(result.state);
          return result;
        },
        true,
      );
    } finally {
      writeLog('window', { event: 'closed', window: 'bilibili-login' });
    }
  }

  async function logoutBilibiliAccount() {
    logBilibiliDiagnostic('logout-start');
    try {
      const state = await runAccountOperation('bilibili', async () =>
        observeBilibiliIdentity(await bilibiliAuth.logoutBilibiliAccount(getDataDir())),
      );
      logBilibiliDiagnostic('logout-complete', summarizeAuthState(state));
      return state;
    } catch (error) {
      logBilibiliDiagnostic('logout-failed');
      throw error;
    }
  }

  return {
    dispose,
    whenIdle,
    getMusicAuthState,
    getMusicCookieHeader,
    getMusicProviderRegistry,
    loginMusicAccount,
    logoutMusicAccount,
    clearMusicBrowserCache,
    restoreMusicCookieSnapshots,
    getBilibiliAuthState,
    getBilibiliAccountProfile,
    getBilibiliCookieHeader,
    getBilibiliUid,
    getBilibiliSessionRevision,
    getBilibiliRequestIdentity,
    getBilibiliIdentityRevision: () => bilibiliIdentityRevision,
    restoreBilibiliCookieSnapshot,
    replaceBilibiliCookieHeader,
    loginBilibiliAccount,
    logoutBilibiliAccount,
  };
}

module.exports = { createDesktopAuthController };
