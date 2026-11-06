'use strict';

const { sanitizeWelcomeFieldErrors } = require('../../shared/welcome-settings-contract');

class RemoteLicenseError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
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
