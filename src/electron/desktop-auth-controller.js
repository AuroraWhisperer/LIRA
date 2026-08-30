'use strict';

const authManager = require('./auth-manager');
const bilibiliAuth = require('./bilibili-auth');
const { openBilibiliLoginWindow } = require('./bilibili-login-window');
const musicLoginWindow = require('./login-window');
const { createMusicProviderRegistry } = require('../music/provider-registry');

function createDesktopAuthController({
  BrowserWindow,
  shell,
  getMainWindow,
  getDataDir,
  writeLog,
}) {
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
      return await musicLoginWindow.loginMusicAccount(
        getMainWindow(),
        platform,
        getDataDir(),
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

  function getBilibiliUid() {
    return bilibiliAuth.getBilibiliUid();
  }

  function restoreBilibiliCookieSnapshot() {
    return bilibiliAuth.restoreBilibiliCookieSnapshot(getDataDir());
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

  function logoutBilibiliAccount() {
    return bilibiliAuth.logoutBilibiliAccount(getDataDir());
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
    getBilibiliCookieHeader,
    getBilibiliUid,
    restoreBilibiliCookieSnapshot,
    loginBilibiliAccount,
    logoutBilibiliAccount,
  };
}

module.exports = { createDesktopAuthController };
