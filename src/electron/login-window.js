// 编写人：Aurora
// 音乐平台扫码登录窗口。
'use strict';

const { BrowserWindow, shell, session } = require('electron');
const path = require('node:path');
const {
  MUSIC_LOGIN_CONFIG,
  normalizeMusicPlatform,
  isAllowedMusicLoginUrl,
  persistMusicCookieSnapshot,
  getMusicAuthState,
} = require('./auth-manager');
const { isAllowedLoginNavigation, isAllowedExternal } = require('./external-url-policy');

async function loginMusicAccount(mainWindow, platform, dataDir, { signal } = {}) {
  platform = normalizeMusicPlatform(platform);
  const config = MUSIC_LOGIN_CONFIG[platform];
  const loginWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    title: `登录${config.name}`,
    parent: mainWindow || undefined,
    modal: false,
    show: true,
    webPreferences: {
      partition: config.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const loginSession = loginWindow.webContents.session;
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLoginNavigation(url, config.allowedHosts)) {
      loginWindow.loadURL(url).catch((error) => writeLog('music-login-navigation', error));
    } else if (isAllowedExternal(url)) {
      shell.openExternal(url).catch((error) => writeLog('music-login-external', error));
    }
    return { action: 'deny' };
  });

  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedLoginNavigation(url, config.allowedHosts)) return;
    event.preventDefault();
    if (isAllowedExternal(url)) {
      shell.openExternal(url).catch((error) => writeLog('music-login-external', error));
    }
  });

  let cookieSaveTimer = null;
  let loginCheckTimer = null;
  let loginCheckInFlight = false;
  let cookieSaveJob = Promise.resolve();

  const scheduleCookieSave = () => {
    clearTimeout(cookieSaveTimer);
    cookieSaveTimer = setTimeout(() => {
      cookieSaveJob = cookieSaveJob.then(() => persistMusicCookieSnapshot(platform, dataDir))
        .catch((error) => writeLog('music-cookie-save', error));
    }, 800);
  };

  const checkLoginComplete = async () => {
    if (loginCheckInFlight || loginWindow.isDestroyed()) return;
    loginCheckInFlight = true;
    try {
      const state = await getMusicAuthState(platform, dataDir);
      if (state.loggedIn && !loginWindow.isDestroyed()) {
        writeLog('music-login-auto-close', `${config.name} 登录成功，自动关闭登录窗口`);
        loginWindow.close();
      }
    } catch (_) {
      writeLog('music-auth-check', '暂时无法读取登录状态，将在下次检查重试。');
    } finally {
      loginCheckInFlight = false;
    }
  };

  const onCookieChanged = () => {
    scheduleCookieSave();
    checkLoginComplete();
  };
  loginSession.cookies.on('changed', onCookieChanged);

  const cleanup = () => {
    clearTimeout(cookieSaveTimer);
    clearInterval(loginCheckTimer);
    loginSession.cookies.removeListener('changed', onCookieChanged);
    signal?.removeEventListener('abort', cancel);
  };

  const cancel = () => {
    if (!loginWindow.isDestroyed()) loginWindow.destroy();
  };

  loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (isMainFrame === false) return;
    writeLog('music-login-load-failure', {
      errorCode,
      errorDescription,
      platform,
    });
    cleanup();
    if (!loginWindow.isDestroyed()) {
      loginWindow.destroy();
    }
  });

  const completion = new Promise((resolve) => {
    loginWindow.once('closed', async () => {
      cleanup();
      await cookieSaveJob;
      let snapshot = null;
      try {
        if (!signal?.aborted) snapshot = await persistMusicCookieSnapshot(platform, dataDir);
      } catch (error) {
        writeLog('music-cookie-save', error);
      }
      let state = { loggedIn: false };
      try {
        state = await getMusicAuthState(platform, dataDir);
      } catch (error) {
        writeLog('music-auth-state', error);
      }
      resolve({ platform, snapshot, state });
    });
  });

  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) {
    cancel();
    return completion;
  }

  try {
    await loginWindow.loadURL(config.loginUrl);
  } catch (error) {
    cleanup();
    if (!loginWindow.isDestroyed()) {
      loginWindow.destroy();
    }
    await completion;
    if (signal?.aborted) return completion;
    throw error;
  }

  // Also poll every 1.5s as a safety net while the login window is still open.
  if (!loginWindow.isDestroyed()) loginCheckTimer = setInterval(checkLoginComplete, 1500);
  return completion;
}

function writeLog(scope, value) {
  const message =
    value instanceof Error
      ? `${value.stack || value.message}`
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  console.log(`[${scope}] ${message}`);
}

module.exports = { loginMusicAccount };
