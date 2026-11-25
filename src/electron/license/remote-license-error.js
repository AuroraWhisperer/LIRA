'use strict';

const { sanitizeWelcomeFieldErrors } = require('../../shared/welcome-settings-contract');

const DEFAULT_ERROR_MESSAGES = Object.freeze({
  INVALID_RESPONSE: '授权服务器返回无效响应。',
  RESPONSE_TOO_LARGE: '授权服务器响应过大。',
  REQUEST_TIMEOUT: '连接授权服务器超时，请重试。',
  NETWORK_UNAVAILABLE: '无法连接授权服务器，请检查网络后重试。',
  DEVICE_SESSION_INVALID: '授权服务器未返回有效会话标识。',
  BACKGROUND_URL_INVALID: '服务器返回的背景地址无效。',
});

class RemoteLicenseError extends Error {
  constructor(code, message, options = {}) {
    super(message || DEFAULT_ERROR_MESSAGES[code] || code);
    this.name = 'RemoteLicenseError';
    this.code = code;
    this.status = options.status || 0;
    this.retryable = options.retryable === true;
    if (Number.isSafeInteger(options.retryAfterMs) && options.retryAfterMs >= 0)
      this.retryAfterMs = options.retryAfterMs;
    const index = normalizeErrorIndex(options.index);
    if (index !== undefined) this.index = index;
    this.fieldErrors = sanitizeWelcomeFieldErrors(options.fieldErrors);
  }
}

function normalizeErrorCode(value, fallback = 'LICENSE_ERROR') {
  const code = String(value ?? '').trim();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : fallback;
}

function normalizeErrorIndex(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

module.exports = { RemoteLicenseError, normalizeErrorCode, normalizeErrorIndex };
