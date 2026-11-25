// 编写人：Aurora
// 音乐平台扫码登录窗口。
'use strict';

const { BrowserWindow, shell } = require('electron');
const {
  MUSIC_LOGIN_CONFIG,
  normalizeMusicPlatform,
  persistMusicCookieSnapshot,
  getMusicAuthState,
  getMusicSessionState,
} = require('./music-auth-manager');
const { openLoginWindow } = require('./login-window');

async function loginMusicAccount(mainWindow, platform, dataDir, { signal, writeLog } = {}) {
  platform = normalizeMusicPlatform(platform);
  const config = MUSIC_LOGIN_CONFIG[platform];
  const result = await openLoginWindow({
    BrowserWindow, shell, config, mainWindow, title: `登录${config.name}`, signal, scope: 'music',
    writeLog: (scope, details) => writeLog?.(scope, scope === 'music-login-load-failure' ? { platform, ...details } : details),
    persistCookies: () => persistMusicCookieSnapshot(platform, dataDir),
    getSessionState: () => getMusicSessionState(platform),
    getAuthState: () => getMusicAuthState(platform, dataDir),
  });
  return { platform, ...result };
}

module.exports = { loginMusicAccount };
