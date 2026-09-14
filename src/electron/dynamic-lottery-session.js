'use strict';

const crypto = require('node:crypto');

const REQUIRED_COOKIE_NAMES = ['DedeUserID', 'SESSDATA', 'bili_jct'];

function createSessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeStreamerId(identity) {
  const value = identity?.streamerId;
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 128 || /[\r\n\0]/u.test(normalized)) {
    return '';
  }
  return normalized;
}

function fingerprintAuthCookies(cookieHeader) {
  const value = typeof cookieHeader === 'string' ? cookieHeader.trim() : '';
  if (!value || value.length > 64 * 1024 || /[\r\n\0]/u.test(value)) {
    return '';
  }

  const selected = new Map();
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!REQUIRED_COOKIE_NAMES.includes(name)) continue;
    const cookieValue = part.slice(separator + 1).trim();
    if (!cookieValue) return '';
    const values = selected.get(name) || [];
    values.push(cookieValue);
    selected.set(name, values);
  }
  if (REQUIRED_COOKIE_NAMES.some((name) => !selected.has(name))) return '';

  const normalized = REQUIRED_COOKIE_NAMES.map((name) => [
    name,
    [...selected.get(name)].sort(),
  ]);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

function createLotterySession({
  getCookieHeader,
  getIdentity,
  getAuthorizationEpoch,
}) {
  if (
    typeof getCookieHeader !== 'function' ||
    typeof getIdentity !== 'function' ||
    typeof getAuthorizationEpoch !== 'function'
  ) {
    throw new TypeError('Lottery session dependencies are required.');
  }

  let disposed = false;
  let observedKey = null;
  let sessionEpoch = 0;
  let queue = Promise.resolve();

  function observe(key) {
    if (key === observedKey) return;
    observedKey = key;
    sessionEpoch += 1;
  }

  async function readContext() {
    if (disposed) {
      throw createSessionError(
        'LOTTERY_SESSION_DISPOSED',
        'Dynamic lottery session has been disposed.',
      );
    }

    const identity = await getIdentity();
    const streamerId = normalizeStreamerId(identity);
    const authorizationEpoch = Number(await getAuthorizationEpoch());
    const cookieHeader = await getCookieHeader();
    const cookieFingerprint = fingerprintAuthCookies(cookieHeader);
    const validAuthorizationEpoch =
      Number.isSafeInteger(authorizationEpoch) && authorizationEpoch >= 0;
    const key = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          streamerId,
          authorizationEpoch: validAuthorizationEpoch
            ? authorizationEpoch
            : null,
          cookieFingerprint,
        }),
      )
      .digest('hex');
    observe(key);

    if (!streamerId || !validAuthorizationEpoch) {
      throw createSessionError(
        'LOTTERY_IDENTITY_UNAVAILABLE',
        'A trusted LIRA streamer identity is required.',
      );
    }
    if (!cookieFingerprint) {
      throw createSessionError(
        'LOTTERY_SESSION_UNAVAILABLE',
        'A complete Bilibili login session is required.',
      );
    }
    if (disposed) {
      throw createSessionError(
        'LOTTERY_SESSION_DISPOSED',
        'Dynamic lottery session has been disposed.',
      );
    }

    return {
      streamerId,
      authorizationEpoch,
      sessionEpoch,
      cookieHeader,
    };
  }

  function getContext() {
    const result = queue.then(readContext, readContext);
    queue = result.catch(() => undefined);
    return result;
  }

  function dispose() {
    disposed = true;
    observedKey = null;
  }

  return { getContext, dispose };
}

module.exports = { createLotterySession };
