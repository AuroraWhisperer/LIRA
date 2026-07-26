// 编写人：Aurora
// 音乐平台扫码登录窗口。
'use strict';

const { BrowserWindow, shell, session } = require('electron');
const path = require('node:path');
const { MUSIC_LOGIN_CONFIG, isAllowedMusicLoginUrl, persistMusicCookieSnapshot, getMusicAuthState } = require('./auth-manager');

async function loginMusicAccount(mainWindow, platform, dataDir) {
  const config = MUSIC_LOGIN_CONFIG[platform];
  const loginWindow = new BrowserWindow({
    width: 1000, height: 720,
    title: `登录${config.name}`,
    parent: mainWindow || undefined,
    modal: false, show: true,
    webPreferences: {
      partition: config.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const loginSession = loginWindow.webContents.session;
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedMusicLoginUrl(platform, url)) {
      loginWindow.loadURL(url).catch((error) => writeLog('music-login-navigation', error));
    } else {
      shell.openExternal(url).catch((error) => writeLog('music-login-external', error));
    }
    return { action: 'deny' };
  });

  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMusicLoginUrl(platform, url)) return;
    event.preventDefault();
    shell.openExternal(url).catch((error) => writeLog('music-login-external', error));
  });

  let cookieSaveTimer = null;
  const scheduleCookieSave = () => {
    clearTimeout(cookieSaveTimer);
    cookieSaveTimer = setTimeout(() => {
      persistMusicCookieSnapshot(platform, dataDir).catch((error) => writeLog('music-cookie-save', error));
    }, 800);
  };
  loginSession.cookies.on('changed', scheduleCookieSave);

  await loginWindow.loadURL(config.loginUrl);

  return new Promise((resolve) => {
    loginWindow.on('closed', async () => {
      clearTimeout(cookieSaveTimer);
      loginSession.cookies.removeListener('changed', scheduleCookieSave);
      let snapshot = null;
      try { snapshot = await persistMusicCookieSnapshot(platform, dataDir); }
      catch (error) { writeLog('music-cookie-save', error); }
      resolve({
        platform,
        snapshot,
        state: await getMusicAuthState(platform, dataDir)
      });
    });
  });
}

function writeLog(scope, value) {
  // Placeholder — log path injected by caller or derived from env.
  const message = value instanceof Error
    ? `${value.stack || value.message}`
    : typeof value === 'string' ? value : JSON.stringify(value);
  console.log(`[${scope}] ${message}`);
}

module.exports = { loginMusicAccount };
