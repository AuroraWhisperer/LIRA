'use strict';

const { mapSongForSync } = require('../../shared/cloud-song-snapshot');
const { isSensitiveFieldName: isSensitiveResponseKey } = require('../../shared/sensitive-field-name');

const { RemoteLicenseError, normalizeErrorCode } = require('./remote-license-error');

const SONG_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
const SONG_BACKGROUND_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
]);

function getErrorCode(error) {
  const raw = error instanceof RemoteLicenseError ? error.code : error?.code || error?.message || 'NETWORK_UNAVAILABLE';
  return normalizeErrorCode(raw);
}

function isRetryableAuthError(error) {
  const code = getErrorCode(error);
  return (
    Boolean(error?.retryable) ||
    code === 'NETWORK_UNAVAILABLE' ||
    code === 'REQUEST_TIMEOUT' ||
    Number(error?.status) === 408 ||
    Number(error?.status) === 429 ||
    Number(error?.status) >= 500
  );
}

function sanitizeRemoteResponse(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRemoteResponse(item, seen)).filter((item) => item !== undefined);
  }

  const entries = [];
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveResponseKey(key)) continue;
    const sanitized = sanitizeRemoteResponse(nested, seen);
    if (sanitized !== undefined) entries.push([key, sanitized]);
  }
  return Object.fromEntries(entries);
}

function addSongBackgroundPreviewUrl(result, baseUrl) {
  if (!result?.background) return result;
  const pathname = String(result.background.url || '');
  if (!pathname.startsWith('/')) throw new RemoteLicenseError('BACKGROUND_URL_INVALID', '服务器返回的背景地址无效。');
  try {
    const origin = new URL(String(baseUrl || '')).origin;
    const preview = new URL(pathname, origin);
    if (preview.origin !== origin || preview.username || preview.password) throw new Error('origin mismatch');
    for (const key of preview.searchParams.keys()) {
      if (isSensitiveResponseKey(key)) throw new Error('credential query parameter');
    }
    return {
      ...result,
      background: { ...result.background, previewUrl: preview.href },
    };
  } catch (_) {
    throw new RemoteLicenseError('BACKGROUND_URL_INVALID', '服务器返回的背景地址无效。');
  }
}

function sanitizeStreamer(value) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    accountName: String(value.accountName || '').slice(0, 32),
    displayName: String(value.displayName || value.accountName || '').slice(0, 80),
    subdomain: String(value.subdomain || '').slice(0, 63),
    songPageUrl: String(value.songPageUrl || '').slice(0, 300),
    manageUrl: String(value.manageUrl || '').slice(0, 300),
  };
}

function sanitizeDevice(value) {
  return {
    id: String(value.id || '').slice(0, 128),
    name: String(value.name || '').slice(0, 100),
    status: String(value.status || '').slice(0, 32),
    licenseId: String(value.licenseId || '').slice(0, 128),
  };
}

module.exports = {
  SONG_BACKGROUND_MAX_BYTES,
  SONG_BACKGROUND_TYPES,
  addSongBackgroundPreviewUrl,
  getErrorCode,
  isRetryableAuthError,
  isSensitiveResponseKey,
  mapSongForSync,
  sanitizeDevice,
  sanitizeRemoteResponse,
  sanitizeStreamer,
};
