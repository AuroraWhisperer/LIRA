// 编写人：Aurora
// 音乐平台 Cookie / 登录状态管理。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeStorage, session } = require('electron');

const MUSIC_LOGIN_CONFIG = {
  qq: {
    name: 'QQ音乐',
    partition: 'persist:music-qq',
    loginUrl: 'https://y.qq.com/',
    allowedHosts: ['y.qq.com', 'i.y.qq.com', 'graph.qq.com', 'ssl.ptlogin2.qq.com', 'xui.ptlogin2.qq.com', 'ui.ptlogin2.qq.com', 'ptlogin2.qq.com', 'qq.com'],
    cookieDomains: ['.qq.com', '.y.qq.com', 'y.qq.com'],
    keyCookies: ['uin', 'qqmusic_uin', 'qqmusic_key', 'p_skey', 'skey', 'wxuin']
  },
  netease: {
    name: '网易云音乐',
    partition: 'persist:music-netease',
    loginUrl: 'https://music.163.com/',
    allowedHosts: ['music.163.com', 'interface.music.163.com', 'interface3.music.163.com', 'passport.163.com', 'reg.163.com', '163.com'],
    cookieDomains: ['.163.com', '.music.163.com', 'music.163.com'],
    keyCookies: ['MUSIC_U', '__csrf']
  }
};

function normalizeMusicPlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (!MUSIC_LOGIN_CONFIG[platform]) {
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

function isAllowedMusicCookie(platform, cookie) {
  const config = MUSIC_LOGIN_CONFIG[platform];
  const domain = String(cookie.domain || '').toLowerCase();
  return config.cookieDomains.some((allowed) => {
    const cleanAllowed = allowed.toLowerCase();
    const hostAllowed = cleanAllowed.replace(/^\./, '');
    return domain === cleanAllowed || domain === hostAllowed || domain.endsWith(`.${hostAllowed}`);
  });
}

function isAllowedMusicLoginUrl(platform, rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  return MUSIC_LOGIN_CONFIG[platform].allowedHosts.some((allowed) => {
    const cleanAllowed = allowed.toLowerCase();
    return host === cleanAllowed || host.endsWith(`.${cleanAllowed}`);
  });
}

async function getAllowedMusicCookies(platform) {
  const loginSession = session.fromPartition(MUSIC_LOGIN_CONFIG[platform].partition);
  const cookies = await loginSession.cookies.get({});
  return cookies.filter((cookie) => isAllowedMusicCookie(platform, cookie));
}

function toSerializableCookie(cookie) {
  return {
    name: cookie.name, value: cookie.value, domain: cookie.domain,
    path: cookie.path || '/', secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true, expirationDate: cookie.expirationDate
  };
}

function toElectronCookieDetails(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  const protocol = cookie.secure === false ? 'http' : 'https';
  const details = {
    url: `${protocol}://${domain}${cookie.path || '/'}`,
    name: cookie.name, value: cookie.value, domain: cookie.domain,
    path: cookie.path || '/', secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true
  };
  if (Number.isFinite(Number(cookie.expirationDate))) {
    details.expirationDate = Number(cookie.expirationDate);
  }
  return details;
}

async function persistMusicCookieSnapshot(platform, dataDir) {
  const cookies = await getAllowedMusicCookies(platform);
  const payload = { platform, savedAt: new Date().toISOString(), cookies: cookies.map(toSerializableCookie) };

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 当前不可用，已保留 Electron partition Cookie，但不会写入明文快照。');
  }

  const authDir = getMusicAuthDir(dataDir);
  fs.mkdirSync(authDir, { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(payload));
  fs.writeFileSync(getMusicCookieSnapshotPath(dataDir, platform), encrypted.toString('base64'), 'utf8');
  return { savedAt: payload.savedAt, cookieCount: payload.cookies.length };
}

async function restoreMusicCookieSnapshot(platform, dataDir) {
  const snapshotPath = getMusicCookieSnapshotPath(dataDir, platform);
  if (!fs.existsSync(snapshotPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;

  try {
    const encrypted = Buffer.from(fs.readFileSync(snapshotPath, 'utf8'), 'base64');
    const payload = JSON.parse(safeStorage.decryptString(encrypted));
    const loginSession = session.fromPartition(MUSIC_LOGIN_CONFIG[platform].partition);
    for (const cookie of Array.isArray(payload.cookies) ? payload.cookies : []) {
      await loginSession.cookies.set(toElectronCookieDetails(cookie));
    }
    return { savedAt: payload.savedAt || '', cookieCount: Array.isArray(payload.cookies) ? payload.cookies.length : 0 };
  } catch (_) { return null; }
}

async function getMusicAuthState(platform, dataDir) {
  const config = MUSIC_LOGIN_CONFIG[platform];
  const cookies = await getAllowedMusicCookies(platform);
  const cookieNames = new Set(cookies.map((c) => c.name));
  const presentKeyCookies = config.keyCookies.filter((name) => cookieNames.has(name));

  let snapshotMeta = { exists: false, savedAt: '' };
  const snapshotPath = getMusicCookieSnapshotPath(dataDir, platform);
  if (fs.existsSync(snapshotPath) && safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = Buffer.from(fs.readFileSync(snapshotPath, 'utf8'), 'base64');
      const payload = JSON.parse(safeStorage.decryptString(encrypted));
      snapshotMeta = { exists: true, savedAt: payload.savedAt || '' };
    } catch (_) { snapshotMeta.exists = true; }
  }

  return {
    platform, name: config.name,
    loggedIn: presentKeyCookies.length > 0,
    cookieCount: cookies.length,
    keyCookieNames: presentKeyCookies,
    encryptedSnapshotExists: snapshotMeta.exists,
    lastSavedAt: snapshotMeta.savedAt,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

async function getMusicCookieHeader(platform) {
  const cookies = await getAllowedMusicCookies(platform);
  return cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

async function logoutMusicAccount(platform, dataDir) {
  const loginSession = session.fromPartition(MUSIC_LOGIN_CONFIG[platform].partition);
  await loginSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql'] });
  const snapshotPath = getMusicCookieSnapshotPath(dataDir, platform);
  if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  return getMusicAuthState(platform, dataDir);
}

module.exports = {
  MUSIC_LOGIN_CONFIG,
  normalizeMusicPlatform,
  isAllowedMusicLoginUrl,
  getMusicAuthState,
  getMusicCookieHeader,
  persistMusicCookieSnapshot,
  restoreMusicCookieSnapshot,
  getAllowedMusicCookies,
  logoutMusicAccount
};
