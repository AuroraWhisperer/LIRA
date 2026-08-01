// 编写人：Aurora
// Bilibili 直播账号 Cookie / 登录状态管理。
// 与 auth-manager.js 同模式，但管理 bilibili.com 的 cookies。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeStorage, session } = require('electron');

const BILIBILI_LOGIN_CONFIG = {
  name: 'Bilibili',
  partition: 'persist:bilibili',
  loginUrl: 'https://live.bilibili.com/',
  allowedHosts: [
    'bilibili.com', 'www.bilibili.com', 'live.bilibili.com',
    'passport.bilibili.com', 'api.bilibili.com', 'api.live.bilibili.com',
    'space.bilibili.com', 'message.bilibili.com', 'member.bilibili.com',
    'account.bilibili.com'
  ],
  cookieDomains: ['.bilibili.com', 'bilibili.com', '.live.bilibili.com', 'live.bilibili.com'],
  keyCookies: ['DedeUserID', 'SESSDATA', 'bili_jct']
};

function getBilibiliAuthDir(dataDir) {
  return path.join(dataDir || '', 'bilibili-auth');
}

function getBilibiliCookieSnapshotPath(dataDir) {
  return path.join(getBilibiliAuthDir(dataDir), 'cookies.enc');
}

function getBilibiliCookieExportPath(dataDir) {
  return path.join(getBilibiliAuthDir(dataDir), 'cookies.txt');
}

function isAllowedBilibiliCookie(cookie) {
  const config = BILIBILI_LOGIN_CONFIG;
  const domain = String(cookie.domain || '').toLowerCase();
  return config.cookieDomains.some((allowed) => {
    const cleanAllowed = allowed.toLowerCase();
    const hostAllowed = cleanAllowed.replace(/^\./, '');
    return domain === cleanAllowed || domain === hostAllowed || domain.endsWith(`.${hostAllowed}`);
  });
}

function isAllowedBilibiliLoginUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  return BILIBILI_LOGIN_CONFIG.allowedHosts.some((allowed) => {
    const cleanAllowed = allowed.toLowerCase();
    return host === cleanAllowed || host.endsWith(`.${cleanAllowed}`);
  });
}

async function getAllowedBilibiliCookies() {
  const loginSession = session.fromPartition(BILIBILI_LOGIN_CONFIG.partition);
  const cookies = await loginSession.cookies.get({});
  return cookies.filter((cookie) => isAllowedBilibiliCookie(cookie));
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

async function persistBilibiliCookieSnapshot(dataDir) {
  const cookies = await getAllowedBilibiliCookies();
  const payload = { savedAt: new Date().toISOString(), cookies: cookies.map(toSerializableCookie) };

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 当前不可用，已保留 Electron partition Cookie，但不会写入明文快照。');
  }

  const authDir = getBilibiliAuthDir(dataDir);
  fs.mkdirSync(authDir, { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(payload));
  fs.writeFileSync(getBilibiliCookieSnapshotPath(dataDir), encrypted.toString('base64'), 'utf8');

  const exportPath = getBilibiliCookieExportPath(dataDir);
  if (fs.existsSync(exportPath) || process.env.BILIBILI_PLAINTEXT_COOKIE_EXPORT === '1') {
    const cookieHeader = cookies
      .filter((cookie) => cookie.name && cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    fs.writeFileSync(exportPath, cookieHeader, 'utf8');
  }

  return { savedAt: payload.savedAt, cookieCount: payload.cookies.length };
}

async function restoreBilibiliCookieSnapshot(dataDir) {
  const snapshotPath = getBilibiliCookieSnapshotPath(dataDir);
  if (!fs.existsSync(snapshotPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;

  try {
    const encrypted = Buffer.from(fs.readFileSync(snapshotPath, 'utf8'), 'base64');
    const payload = JSON.parse(safeStorage.decryptString(encrypted));
    const loginSession = session.fromPartition(BILIBILI_LOGIN_CONFIG.partition);
    for (const cookie of Array.isArray(payload.cookies) ? payload.cookies : []) {
      await loginSession.cookies.set(toElectronCookieDetails(cookie));
    }
    return { savedAt: payload.savedAt || '', cookieCount: Array.isArray(payload.cookies) ? payload.cookies.length : 0 };
  } catch (_) { return null; }
}

async function getBilibiliAuthState(dataDir) {
  const config = BILIBILI_LOGIN_CONFIG;
  const cookies = await getAllowedBilibiliCookies();
  const cookieNames = new Set(cookies.map((c) => c.name));
  const presentKeyCookies = config.keyCookies.filter((name) => cookieNames.has(name));
  const allKeyCookiesPresent = config.keyCookies.every((name) => cookieNames.has(name));

  // 提取用户信息
  const dedeUserId = cookies.find((c) => c.name === 'DedeUserID');
  const uid = dedeUserId ? Number(dedeUserId.value) : 0;
  const sessdata = cookies.find((c) => c.name === 'SESSDATA');

  let snapshotMeta = { exists: false, savedAt: '' };
  const snapshotPath = getBilibiliCookieSnapshotPath(dataDir);
  if (fs.existsSync(snapshotPath) && safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = Buffer.from(fs.readFileSync(snapshotPath, 'utf8'), 'base64');
      const payload = JSON.parse(safeStorage.decryptString(encrypted));
      snapshotMeta = { exists: true, savedAt: payload.savedAt || '' };
    } catch (_) { snapshotMeta.exists = true; }
  }

  const exportedCookieExists = fs.existsSync(getBilibiliCookieExportPath(dataDir));

  return {
    name: config.name,
    loggedIn: allKeyCookiesPresent,
    uid,
    cookieCount: cookies.length,
    keyCookieNames: presentKeyCookies,
    hasSessdata: !!sessdata,
    encryptedSnapshotExists: snapshotMeta.exists,
    lastSavedAt: snapshotMeta.savedAt,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    exportedCookieExists
  };
}

async function getBilibiliCookieHeader() {
  const cookies = await getAllowedBilibiliCookies();
  return cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

async function getBilibiliUid() {
  const cookies = await getAllowedBilibiliCookies();
  const dede = cookies.find((c) => c.name === 'DedeUserID');
  return dede ? Number(dede.value) : 0;
}

async function logoutBilibiliAccount(dataDir) {
  const loginSession = session.fromPartition(BILIBILI_LOGIN_CONFIG.partition);
  await loginSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql'] });
  const snapshotPath = getBilibiliCookieSnapshotPath(dataDir);
  if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  // 清理旧版明文导出文件
  const exportPath = getBilibiliCookieExportPath(dataDir);
  if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath);
  return getBilibiliAuthState(dataDir);
}

module.exports = {
  BILIBILI_LOGIN_CONFIG,
  isAllowedBilibiliLoginUrl,
  getBilibiliAuthState,
  getBilibiliCookieHeader,
  getBilibiliUid,
  persistBilibiliCookieSnapshot,
  restoreBilibiliCookieSnapshot,
  logoutBilibiliAccount,
  getBilibiliCookieExportPath
};
