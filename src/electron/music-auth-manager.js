// 编写人：Aurora
// 音乐平台 Cookie / 登录状态管理。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeStorage, session } = require('electron');
const { matchesCookieDomains } = require('./cookie-details');
const { persistCookieSnapshot, restoreCookieSnapshot, getCookieSnapshotMetadata } = require('./cookie-snapshot');

const MUSIC_LOGIN_CONFIG = {
  qq: {
    name: 'QQ音乐',
    partition: 'persist:music-qq',
    loginUrl: 'https://y.qq.com/',
    allowedHosts: [
      'y.qq.com',
      'i.y.qq.com',
      'graph.qq.com',
      'ssl.ptlogin2.qq.com',
      'xui.ptlogin2.qq.com',
      'ui.ptlogin2.qq.com',
      'ptlogin2.qq.com',
      'qq.com',
    ],
    cookieDomains: ['.qq.com', '.y.qq.com', 'y.qq.com'],
    keyCookies: [
      'uin',
      'qqmusic_uin',
      'qqmusic_key',
      'qm_keyst',
      'p_skey',
      'skey',
      'wxuin',
      'p_uin',
      'pt2gguin',
      'superuin',
    ],
    authCookies: ['qqmusic_key', 'qm_keyst'],
  },
  netease: {
    name: '网易云音乐',
    partition: 'persist:music-netease',
    loginUrl: 'https://music.163.com/',
    allowedHosts: [
      'music.163.com',
      'interface.music.163.com',
      'interface3.music.163.com',
      'passport.163.com',
      'reg.163.com',
      '163.com',
    ],
    cookieDomains: ['.163.com', '.music.163.com', 'music.163.com'],
    keyCookies: ['MUSIC_U', '__csrf'],
    authCookies: ['MUSIC_U'],
  },
};

function normalizeMusicPlatform(value) {
  const platform = String(value || '')
    .trim()
    .toLowerCase();
  if (!Object.hasOwn(MUSIC_LOGIN_CONFIG, platform)) {
    throw new Error('音乐平台只能是 qq 或 netease。');
  }
  return platform;
}

function getMusicAuthDir(dataDir) {
  return path.join(dataDir || '', 'music-auth');
}

function getMusicCookieSnapshotPath(dataDir, platform) {
  return path.join(getMusicAuthDir(dataDir), `${platform}.cookies.enc`);
}

async function getAllowedMusicCookies(platform) {
  platform = normalizeMusicPlatform(platform);
  const loginSession = session.fromPartition(MUSIC_LOGIN_CONFIG[platform].partition);
  const cookies = await loginSession.cookies.get({});
  return cookies.filter((cookie) => matchesCookieDomains(cookie, MUSIC_LOGIN_CONFIG[platform].cookieDomains));
}

async function persistMusicCookieSnapshot(platform, dataDir) {
  platform = normalizeMusicPlatform(platform);
  const cookies = await getAllowedMusicCookies(platform);
  return persistCookieSnapshot(getMusicCookieSnapshotPath(dataDir, platform), cookies, safeStorage, { platform });
}

async function restoreMusicCookieSnapshot(platform, dataDir) {
  platform = normalizeMusicPlatform(platform);
  return restoreCookieSnapshot(getMusicCookieSnapshotPath(dataDir, platform),
    () => session.fromPartition(MUSIC_LOGIN_CONFIG[platform].partition), safeStorage);
}

function musicSessionState(platform, cookies) {
  const config = MUSIC_LOGIN_CONFIG[platform];
  const cookieNames = new Set(cookies.map((c) => c.name));
  const presentKeyCookies = config.keyCookies.filter((name) => cookieNames.has(name));
  const authCookieNames = Array.isArray(config.authCookies) ? config.authCookies : config.keyCookies;
  const loggedIn = authCookieNames.some((name) =>
    cookies.some((cookie) => cookie.name === name && typeof cookie.value === 'string' && cookie.value.length > 0),
  );

  return { platform, name: config.name, loggedIn, cookieCount: cookies.length, keyCookieNames: presentKeyCookies };
}

async function getMusicSessionState(platform) {
  platform = normalizeMusicPlatform(platform);
  return musicSessionState(platform, await getAllowedMusicCookies(platform));
}

async function getMusicRequestSession(platform, backupDirectory) {
  platform = normalizeMusicPlatform(platform);
  const cookies = await getAllowedMusicCookies(platform);
  const state = musicSessionState(platform, cookies);
  return {
    state: backupDirectory === undefined ? state : withBackupState(state, backupDirectory),
    cookieHeader: musicCookieHeader(cookies),
  };
}

async function getMusicAuthState(platform, dataDir) {
  return withBackupState(await getMusicSessionState(platform), dataDir);
}

function withBackupState(state, dataDir) {
  const snapshotMeta = getCookieSnapshotMetadata(getMusicCookieSnapshotPath(dataDir, state.platform), safeStorage);

  return {
    ...state,
    encryptedSnapshotExists: snapshotMeta.exists,
    lastSavedAt: snapshotMeta.savedAt,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function musicCookieHeader(cookies) {
  return cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

async function getMusicCookieHeader(platform) {
  return musicCookieHeader(await getAllowedMusicCookies(platform));
}

async function logoutMusicAccount(platform, dataDir) {
  platform = normalizeMusicPlatform(platform);
  const loginSession = session.fromPartition(MUSIC_LOGIN_CONFIG[platform].partition);
  await loginSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'websql'],
  });
  const snapshotPath = getMusicCookieSnapshotPath(dataDir, platform);
  if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  return getMusicAuthState(platform, dataDir);
}

async function clearMusicBrowserCache(platforms = Object.keys(MUSIC_LOGIN_CONFIG)) {
  const cleared = [];
  for (const value of platforms) {
    const platform = normalizeMusicPlatform(value);
    const loginSession = session.fromPartition(MUSIC_LOGIN_CONFIG[platform].partition);
    await loginSession.clearCache();
    await loginSession.clearStorageData({
      storages: ['cachestorage'],
    });
    cleared.push(platform);
  }
  return { cleared };
}

module.exports = {
  MUSIC_LOGIN_CONFIG,
  normalizeMusicPlatform,
  getMusicAuthState,
  getMusicSessionState,
  getMusicRequestSession,
  getMusicCookieHeader,
  persistMusicCookieSnapshot,
  restoreMusicCookieSnapshot,
  getAllowedMusicCookies,
  logoutMusicAccount,
  clearMusicBrowserCache,
};
