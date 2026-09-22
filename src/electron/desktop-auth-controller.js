'use strict';

const authManager = require('./auth-manager');
const bilibiliAuth = require('./bilibili-auth');
const { openBilibiliLoginWindow } = require('./bilibili-login-window');
const musicLoginWindow = require('./login-window');
const { createMusicProviderRegistry } = require('../music/provider-registry');
const { logBilibiliDiagnostic, summarizeAuthState } = require('../bilibili/diagnostics');

function createDesktopAuthController({ BrowserWindow, shell, getMainWindow, getDataDir, writeLog }) {
  let providerRegistry = null;

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
    return authManager.logoutMusicAccount(platform, getDataDir());
  }

  function clearMusicBrowserCache() {
    return authManager.clearMusicBrowserCache();
  }

  async function restoreMusicCookieSnapshots() {
    for (const platform of Object.keys(authManager.MUSIC_LOGIN_CONFIG)) {
      await authManager.restoreMusicCookieSnapshot(platform, getDataDir());
    }
  }

  async function loginMusicAccount(platform) {
    writeLog('window', { event: 'create', window: 'music-login', platform });
    try {
      return await musicLoginWindow.loginMusicAccount(getMainWindow(), platform, getDataDir());
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

  async function restoreBilibiliCookieSnapshot() {
    const snapshot = await bilibiliAuth.restoreBilibiliCookieSnapshot(getDataDir());
    logBilibiliDiagnostic('credentials-restore', { restored: Boolean(snapshot) });
    return snapshot;
  }

  async function replaceBilibiliCookieHeader(cookieHeader) {
    logBilibiliDiagnostic('credentials-import-start');
    try {
      const state = await bilibiliAuth.replaceBilibiliCookieHeader(getDataDir(), cookieHeader);
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
      return await openBilibiliLoginWindow({
        BrowserWindow,
        shell,
        auth: bilibiliAuth,
        mainWindow: getMainWindow(),
        dataDir: getDataDir(),
        writeLog,
      });
    } finally {
      writeLog('window', { event: 'closed', window: 'bilibili-login' });
    }
  }

  async function logoutBilibiliAccount() {
    logBilibiliDiagnostic('logout-start');
    try {
      const state = await bilibiliAuth.logoutBilibiliAccount(getDataDir());
      logBilibiliDiagnostic('logout-complete', summarizeAuthState(state));
      return state;
    } catch (error) {
      logBilibiliDiagnostic('logout-failed');
      throw error;
    }
  }

  return {
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
    restoreBilibiliCookieSnapshot,
    replaceBilibiliCookieHeader,
    loginBilibiliAccount,
    logoutBilibiliAccount,
  };
}

module.exports = { createDesktopAuthController };
