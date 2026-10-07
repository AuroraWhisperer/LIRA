'use strict';

const { isDnsHostname } = require('../../shared/remote-url-policy');
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_LICENSE_STATES = new Set([
  'checking',
  'needs_activation',
  'needs_connection',
  'authorizing',
  'authorized',
  'blocked',
]);

function safeErrorCode(error) {
  const value = String(error?.code || error?.message || 'LICENSE_ERROR');
  return SAFE_ERROR_CODE_PATTERN.test(value) ? value : 'LICENSE_ERROR';
}

function safeState(value) {
  return SAFE_LICENSE_STATES.has(value) ? value : 'checking';
}

function safeErrorIndex(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function copyPrimitiveField(target, source, key) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, key)) return;
  const value = source[key];
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    target[key] = typeof value === 'string' ? value.slice(0, 4096) : value;
  }
}

function sanitizeRelativeUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return undefined;
  try {
    const parsed = new URL(value, 'https://license.invalid');
    if (parsed.origin !== 'https://license.invalid' || parsed.username || parsed.password || hasCredentialQuery(parsed))
      return undefined;
    return value.slice(0, 2048);
  } catch (_) {
    return undefined;
  }
}

function sanitizePublicUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      !isDnsHostname(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      hasCredentialQuery(parsed)
    )
      return undefined;
    return parsed.href.slice(0, 2048);
  } catch (_) {
    return undefined;
  }
}

function hasCredentialQuery(url) {
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    if (
      normalized === 'authorization' ||
      normalized === 'cookie' ||
      normalized === 'password' ||
      normalized === 'passwd' ||
      normalized === 'key' ||
      normalized === 'activationcode' ||
      normalized === 'pairingcode' ||
      normalized === 'fingerprint' ||
      normalized === 'hardwareid' ||
      normalized.includes('privatekey') ||
      normalized.endsWith('token') ||
      normalized.endsWith('secret') ||
      normalized.endsWith('apikey') ||
      normalized.endsWith('signature')
    )
      return true;
  }
  return false;
}

module.exports = { safeErrorCode, safeState, safeErrorIndex, safeString, copyPrimitiveField, sanitizeRelativeUrl, sanitizePublicUrl };
