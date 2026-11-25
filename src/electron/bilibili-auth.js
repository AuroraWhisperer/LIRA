// 编写人：Aurora
// Bilibili 直播账号 Cookie / 登录状态管理。
// 与 music-auth-manager.js 同模式，但管理 bilibili.com 的 cookies。
'use strict';

const { BILIBILI_AUTH_COOKIES } = require('../shared/bilibili-auth-cookies');

const fs = require('node:fs');
const path = require('node:path');
const { safeStorage, session } = require('electron');
const { matchesCookieDomains } = require('./cookie-details');
const { persistCookieSnapshot, restoreCookieSnapshot, getCookieSnapshotMetadata } = require('./cookie-snapshot');
const { BilibiliApiClient } = require('../bilibili/danmaku/api-client');

const BILIBILI_LOGIN_CONFIG = {
  name: 'Bilibili',
  partition: 'persist:bilibili',
  loginUrl: 'https://live.bilibili.com/',
  allowedHosts: [
    'bilibili.com',
    'www.bilibili.com',
    'live.bilibili.com',
    'passport.bilibili.com',
    'api.bilibili.com',
    'api.live.bilibili.com',
    'space.bilibili.com',
    'message.bilibili.com',
    'member.bilibili.com',
    'account.bilibili.com',
  ],
  cookieDomains: ['.bilibili.com', 'bilibili.com', '.live.bilibili.com', 'live.bilibili.com'],
  keyCookies: BILIBILI_AUTH_COOKIES,
};

function getBilibiliAuthDir(dataDir) {
  return path.join(dataDir || '', 'bilibili-auth');
}

function getBilibiliCookieSnapshotPath(dataDir) {
  return path.join(getBilibiliAuthDir(dataDir), 'cookies.enc');
}

function removeLegacyCookieExport(dataDir) {
  fs.rmSync(path.join(getBilibiliAuthDir(dataDir), 'cookies.txt'), { force: true });
}

async function getAllowedBilibiliCookies() {
  const loginSession = session.fromPartition(BILIBILI_LOGIN_CONFIG.partition);
  const cookies = await loginSession.cookies.get({});
  return cookies.filter((cookie) => matchesCookieDomains(cookie, BILIBILI_LOGIN_CONFIG.cookieDomains));
}

async function persistBilibiliCookieSnapshot(dataDir) {
  const cookies = await getAllowedBilibiliCookies();
  const snapshot = persistCookieSnapshot(getBilibiliCookieSnapshotPath(dataDir), cookies, safeStorage);
  removeLegacyCookieExport(dataDir);
  return snapshot;
}

async function restoreBilibiliCookieSnapshot(dataDir) {
  removeLegacyCookieExport(dataDir);
  return restoreCookieSnapshot(getBilibiliCookieSnapshotPath(dataDir),
    () => session.fromPartition(BILIBILI_LOGIN_CONFIG.partition), safeStorage);
}

function sessionStateFromCookies(cookies) {
  const config = BILIBILI_LOGIN_CONFIG;
  const cookieNames = new Set(cookies.map((c) => c.name));
  const presentKeyCookies = config.keyCookies.filter((name) => cookieNames.has(name));
  const allKeyCookiesPresent = config.keyCookies.every((name) => cookieNames.has(name));

  // 提取用户信息
  const dedeUserId = cookies.find((c) => c.name === 'DedeUserID');
  const uid = dedeUserId ? Number(dedeUserId.value) : 0;
  const sessdata = cookies.find((c) => c.name === 'SESSDATA');

  return { name: config.name, loggedIn: allKeyCookiesPresent, uid, cookieCount: cookies.length,
    keyCookieNames: presentKeyCookies, hasSessdata: !!sessdata };
}

async function getBilibiliSessionState() {
  return sessionStateFromCookies(await getAllowedBilibiliCookies());
}

async function getBilibiliAuthState(dataDir) {
  const state = await getBilibiliSessionState();

  const snapshotMeta = getCookieSnapshotMetadata(getBilibiliCookieSnapshotPath(dataDir), safeStorage);

  return {
    ...state,
    encryptedSnapshotExists: snapshotMeta.exists,
    lastSavedAt: snapshotMeta.savedAt,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

async function getBilibiliCookieHeader() {
  return cookieHeaderFromCookies(await getAllowedBilibiliCookies());
}

function cookieHeaderFromCookies(cookies) {
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

async function getBilibiliAccountProfile() {
  const cookies = await getAllowedBilibiliCookies();
  const state = sessionStateFromCookies(cookies);
  if (!state.loggedIn || !state.uid) {
    return { uid: Number(state.uid) || 0, name: '', avatarUrl: '' };
  }

  const client = new BilibiliApiClient('0', {
    cookieHeader: cookieHeaderFromCookies(cookies),
    uid: state.uid,
  });
  let profile;
  try {
    profile = await client.fetchCurrentUserProfile();
  } catch (_) {
    profile = await client.fetchUserProfile(state.uid);
  }
  return {
    uid: state.uid,
    name: profile.name || '',
    avatarUrl: profile.avatarUrl || '',
  };
}

function parseBilibiliCookieHeader(cookieHeader) {
  const value = String(cookieHeader || '').trim();
  if (!value || value.length > 12_000 || /[\r\n\0]/u.test(value)) {
    throw new Error('BILIBILI_CREDENTIALS_INVALID');
  }
  const cookies = [];
  const names = new Set();
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const cookieValue = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(name) || !cookieValue) continue;
    cookies.push({ name, value: cookieValue });
    names.add(name);
  }
  if (BILIBILI_LOGIN_CONFIG.keyCookies.some((name) => !names.has(name))) {
    throw new Error('BILIBILI_CREDENTIALS_INVALID');
  }
  return cookies;
}

async function replaceBilibiliCookieHeader(dataDir, cookieHeader) {
  const cookies = parseBilibiliCookieHeader(cookieHeader);
  const loginSession = session.fromPartition(BILIBILI_LOGIN_CONFIG.partition);
  await loginSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'websql'],
  });
  for (const cookie of cookies) {
    await loginSession.cookies.set({
      url: 'https://www.bilibili.com/',
      name: cookie.name,
      value: cookie.value,
      domain: '.bilibili.com',
      path: '/',
      secure: true,
      httpOnly: cookie.name === 'SESSDATA',
    });
  }
  await persistBilibiliCookieSnapshot(dataDir);
  return getBilibiliAuthState(dataDir);
}

async function logoutBilibiliAccount(dataDir) {
  const loginSession = session.fromPartition(BILIBILI_LOGIN_CONFIG.partition);
  await loginSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'websql'],
  });
  const snapshotPath = getBilibiliCookieSnapshotPath(dataDir);
  if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  removeLegacyCookieExport(dataDir);
  return getBilibiliAuthState(dataDir);
}

module.exports = {
  BILIBILI_LOGIN_CONFIG,
  getBilibiliAuthState,
  getBilibiliSessionState,
  getBilibiliAccountProfile,
  getBilibiliCookieHeader,
  getBilibiliUid,
  persistBilibiliCookieSnapshot,
  restoreBilibiliCookieSnapshot,
  replaceBilibiliCookieHeader,
  logoutBilibiliAccount,
  parseBilibiliCookieHeader,
};
