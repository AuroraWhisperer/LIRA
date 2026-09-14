'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const API_URL = 'https://api.bilibili.com/';
const KEY_COOKIES = ['DedeUserID', 'SESSDATA', 'bili_jct'];

function authError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeCookie(cookie) {
  if (!cookie || typeof cookie !== 'object') return null;
  const domain = String(cookie.domain || '').toLowerCase();
  const host = domain.replace(/^\./u, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/u.test(host)) return null;
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) return null;
  if (
    typeof cookie.name !== 'string' ||
    !/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu.test(cookie.name) ||
    typeof cookie.value !== 'string' ||
    /[;\r\n\0]/u.test(cookie.value) ||
    !/^\/[\x21-\x7e]*$/u.test(cookie.path || '/')
  )
    return null;
  if (
    cookie.expirationDate !== undefined &&
    (!Number.isFinite(cookie.expirationDate) ||
      cookie.expirationDate <= Date.now() / 1000)
  )
    return null;
  return {
    name: cookie.name,
    value: cookie.value,
    domain,
    path: cookie.path || '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    ...(cookie.expirationDate === undefined
      ? {}
      : { expirationDate: cookie.expirationDate }),
    ...(['unspecified', 'no_restriction', 'lax', 'strict'].includes(
      cookie.sameSite,
    )
      ? { sameSite: cookie.sameSite }
      : {}),
  };
}

function createLotteryAuthStore({ session, safeStorage, dataDir, streamerId }) {
  const scopeKey = crypto.createHash('sha256').update(streamerId).digest('hex');
  const partition = `persist:bilibili-dynamic-lottery-${scopeKey}`;
  const loginSession = session.fromPartition(partition);
  const directory = path.join(dataDir, 'dynamic-lottery-auth', scopeKey);
  const snapshotPath = path.join(directory, 'cookies.enc');

  async function getCookies() {
    const cookies = await loginSession.cookies.get({ url: API_URL });
    return cookies.map(normalizeCookie).filter(Boolean);
  }

  async function getAuthState() {
    const cookies = await getCookies();
    const values = new Map(cookies.map(({ name, value }) => [name, value]));
    const uid = values.get('DedeUserID') || '';
    const loggedIn =
      KEY_COOKIES.every((name) => values.get(name)) &&
      /^[1-9]\d{0,63}$/u.test(uid);
    return { loggedIn: Boolean(loggedIn), uid: loggedIn ? uid : '' };
  }

  async function getCookieHeader() {
    return (await getCookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
  }

  async function persist() {
    if (!safeStorage.isEncryptionAvailable())
      throw authError('LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE');
    const cookies = await getCookies();
    const payload = JSON.stringify({ version: 1, streamerId, cookies });
    const encrypted = safeStorage.encryptString(payload);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${snapshotPath}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
      fs.renameSync(temporaryPath, snapshotPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
    await loginSession.cookies.flushStore();
  }

  async function restore() {
    if ((await getAuthState()).loggedIn || !fs.existsSync(snapshotPath)) return;
    if (!safeStorage.isEncryptionAvailable())
      throw authError('LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE');
    try {
      const payload = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(snapshotPath)),
      );
      if (
        payload.version !== 1 ||
        payload.streamerId !== streamerId ||
        !Array.isArray(payload.cookies)
      ) {
        throw authError('LOTTERY_AUTH_RESTORE_FAILED');
      }
      for (const cookie of payload.cookies
        .map(normalizeCookie)
        .filter(Boolean)) {
        await loginSession.cookies.set({
          ...cookie,
          url: `https://${cookie.domain.replace(/^\./u, '')}${cookie.path}`,
        });
      }
    } catch {
      throw authError('LOTTERY_AUTH_RESTORE_FAILED');
    }
  }

  async function clear() {
    // Remove only this scope's snapshot; no live-account files or partitions.
    fs.rmSync(snapshotPath, { force: true });
    await loginSession.clearStorageData();
    await loginSession.cookies.flushStore();
  }

  return { partition, getAuthState, getCookieHeader, persist, restore, clear };
}

module.exports = { createLotteryAuthStore };
