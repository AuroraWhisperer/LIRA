'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { toSerializableCookie, toElectronCookieDetails } = require('./cookie-details');
const { writeAtomicFile } = require('./atomic-file');
const metadataByPath = new Map();

function persistCookieSnapshot(snapshotPath, cookies, safeStorage, fields = {}) {
  const payload = { ...fields, savedAt: new Date().toISOString(), cookies: cookies.map(toSerializableCookie) };
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密存储不可用，登录状态无法安全备份；本次登录仅保留在当前应用中。');
  }
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(payload));
  writeAtomicFile(snapshotPath, encrypted.toString('base64'));
  metadataByPath.delete(snapshotPath);
  return { savedAt: payload.savedAt, cookieCount: payload.cookies.length };
}

async function restoreCookieSnapshot(snapshotPath, getSession, safeStorage) {
  if (!fs.existsSync(snapshotPath) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const payload = readCookieSnapshot(snapshotPath, safeStorage);
    const loginSession = getSession();
    const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
    const current = await loginSession.cookies.get({}).catch(() => []);
    const key = (cookie) => JSON.stringify([cookie.domain, cookie.path || '/', cookie.name]);
    const present = new Map(current.map(cookie => [key(cookie), JSON.stringify(toSerializableCookie(cookie))]));
    for (const cookie of cookies) {
      const id = key(cookie);
      const serialized = JSON.stringify(toSerializableCookie(cookie));
      if (present.get(id) === serialized) continue;
      await loginSession.cookies.set(toElectronCookieDetails(cookie));
      present.set(id, serialized);
    }
    return { savedAt: payload.savedAt || '', cookieCount: cookies.length };
  } catch {
    return null;
  }
}

function getCookieSnapshotMetadata(snapshotPath, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) return { exists: false, savedAt: '' };
  let stat;
  try {
    stat = fs.statSync(snapshotPath, { throwIfNoEntry: false });
    if (!stat) {
      metadataByPath.delete(snapshotPath);
      return { exists: false, savedAt: '' };
    }
    const cached = metadataByPath.get(snapshotPath);
    if (cached?.safeStorage === safeStorage && cached.ino === stat.ino && cached.size === stat.size
      && cached.mtimeMs === stat.mtimeMs && cached.ctimeMs === stat.ctimeMs) {
      return { exists: true, savedAt: cached.savedAt };
    }
    const { savedAt } = readCookieSnapshot(snapshotPath, safeStorage);
    const timestamp = typeof savedAt === 'string' ? savedAt : '';
    metadataByPath.set(snapshotPath, { safeStorage, ino: stat.ino, size: stat.size,
      mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, savedAt: timestamp });
    return { exists: true, savedAt: timestamp };
  } catch {
    metadataByPath.delete(snapshotPath);
    return { exists: Boolean(stat), savedAt: '' };
  }
}

function readCookieSnapshot(snapshotPath, safeStorage) {
  return JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(snapshotPath, 'utf8'), 'base64')));
}

module.exports = { persistCookieSnapshot, restoreCookieSnapshot, getCookieSnapshotMetadata };
