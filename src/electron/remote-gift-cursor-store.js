'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDnsHostname } = require('../shared/remote-url-policy');

const CURSOR_FILE_NAME = 'remote-gift-cursor.json';
const MAX_CURSOR_FILE_BYTES = 4096;

function createRemoteGiftCursorStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || ''));
  if (!options.dataDir) throw new Error('dataDir is required');
  const filePath = path.join(dataDir, CURSOR_FILE_NAME);
  const tempPath = `${filePath}.tmp-${process.pid}`;

  function load(sourceKey) {
    const key = normalizeSourceKey(sourceKey);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_CURSOR_FILE_BYTES) return null;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (
        parsed?.version !== 1 ||
        parsed.sourceKey !== key ||
        !Number.isSafeInteger(parsed.cursor) ||
        parsed.cursor < 0
      ) {
        return null;
      }
      return parsed.cursor;
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  function save(sourceKey, cursor) {
    const key = normalizeSourceKey(sourceKey);
    const normalizedCursor = Number(cursor);
    if (!Number.isSafeInteger(normalizedCursor) || normalizedCursor < 0) {
      throw new Error('INVALID_GIFT_CURSOR');
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const serialized = `${JSON.stringify({
      version: 1,
      sourceKey: key,
      cursor: normalizedCursor,
    })}\n`;
    try {
      fs.writeFileSync(tempPath, serialized, {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch (cleanupError) {
        // Best-effort cleanup of this store's exact temporary file.
        void cleanupError;
      }
      throw error;
    }
    return normalizedCursor;
  }

  return { filePath, load, save };
}

function createRemoteGiftSourceKey(baseUrl, streamer = {}) {
  const accountName = String(streamer.accountName || '').trim().toLowerCase();
  if (!accountName) {
    throw new Error('REMOTE_GIFT_SOURCE_UNAVAILABLE');
  }
  const source = [
    'gift-source-v1',
    canonicalizeGiftSourceOrigin(baseUrl),
    accountName,
  ].join('\n');
  return crypto.createHash('sha256').update(source).digest('hex');
}

function canonicalizeGiftSourceOrigin(baseUrl) {
  let parsed;
  try {
    parsed = new URL(String(baseUrl || '').trim());
  } catch {
    throw new Error('INVALID_GIFT_SOURCE_ORIGIN');
  }
  if (
    parsed.protocol !== 'https:' ||
    !isDnsHostname(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('INVALID_GIFT_SOURCE_ORIGIN');
  }
  return parsed.origin;
}

function normalizeSourceKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(key)) {
    throw new Error('INVALID_GIFT_SOURCE');
  }
  return key;
}

module.exports = {
  CURSOR_FILE_NAME,
  canonicalizeGiftSourceOrigin,
  createRemoteGiftCursorStore,
  createRemoteGiftSourceKey,
};
