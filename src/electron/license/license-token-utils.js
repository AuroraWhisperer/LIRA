'use strict';

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;

function parseExpiresIn(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return finiteDuration(value * 1000) ?? DEFAULT_TOKEN_TTL_MS;
  }
  const match = String(value ?? '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/i);
  if (!match) return DEFAULT_TOKEN_TTL_MS;
  const amount = Number(match[1]);
  const unit = String(match[2] || 's').toLowerCase();
  const multiplier = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }[unit];
  return finiteDuration(amount * multiplier) ?? DEFAULT_TOKEN_TTL_MS;
}

function resolveTokenExpiresAt(result = {}, nowMs = Date.now()) {
  const currentMs = Number(nowMs);
  const referenceMs = Number.isFinite(currentMs) ? currentMs : Date.now();
  const absolute = parseAbsoluteExpiry(result.expiresAt);
  if (absolute !== null) return absolute;

  const seconds = parseFiniteSeconds(result.expiresInSeconds);
  if (seconds !== null) {
    const relative = finiteDuration(seconds * 1000);
    if (relative !== null) return referenceMs + relative;
  }

  // Keep compatibility with older servers that only return expiresIn. Prefer
  // the explicit machine-readable fields above because legacy strings may be
  // rounded or retained by a proxy during a protocol rollout.
  const duration = parseExpiresIn(result.expiresIn);
  return referenceMs + (duration === null ? DEFAULT_TOKEN_TTL_MS : duration);
}

function parseAbsoluteExpiry(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Numeric timestamps are accepted as either Unix seconds or milliseconds.
    const milliseconds = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteDuration(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseFiniteSeconds(value) {
  if (typeof value === 'number') return finiteDuration(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return finiteDuration(parsed);
}

module.exports = {
  finiteDuration,
  parseAbsoluteExpiry,
  parseExpiresIn,
  parseFiniteSeconds,
  resolveTokenExpiresAt,
};
