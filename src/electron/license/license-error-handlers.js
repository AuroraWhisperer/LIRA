'use strict';

const {
  getErrorCode,
  isRetryableAuthError,
} = require('./license-response-utils');

const BLOCKED_CODES = new Set([
  'DEVICE_REVOKED',
  'LICENSE_REVOKED',
  'STREAMER_DISABLED',
  'STREAMER_NOT_FOUND',
  'DEVICE_FINGERPRINT_MISMATCH',
  'SIGNATURE_INVALID',
  'BUILD_NOT_ALLOWED',
  'INTEGRITY_NOT_VERIFIED',
  'BUILD_ID_REQUIRED',
  'LICENSE_TOKEN_MISMATCH',
  'DEVICE_AUTH_EPOCH_CHANGED',
  'SESSION_SUPERSEDED',
  'SESSION_REVOKED',
  'DEVICE_SESSION_INVALID',
  'DEVICE_TOKEN_INVALID',
  'DEVICE_TOKEN_REQUIRED',
  'INVALID_DEVICE_PROOF',
  'CHALLENGE_PROTOCOL_MISMATCH',
]);

const CONNECTION_CODES = new Set([
  'CHALLENGE_EXPIRED',
  'CHALLENGE_NOT_FOUND',
  'CHALLENGE_ALREADY_USED',
  'CHALLENGE_MISMATCH',
]);

function createLicenseErrorHandlers(options = {}) {
  const states = options.states;

  function handleAuthError(error) {
    if (options.isDisposed()) return options.getState();
    const code = getErrorCode(error);
    options.clearSession();
    options.resetRetryPolicy();
    if (code === 'DEVICE_KEY_CORRUPT' || code === 'DEVICE_KEY_UNAVAILABLE')
      return options.setState(states.NEEDS_ACTIVATION, code);
    if (BLOCKED_CODES.has(code)) return options.setState(states.BLOCKED, code);
    if (isRetryableAuthError(error) || CONNECTION_CODES.has(code))
      return options.setState(states.NEEDS_CONNECTION, code);
    return options.setState(states.NEEDS_ACTIVATION, code);
  }

  function handleProtectedRequestError(error) {
    if (options.isDisposed()) return;
    const code = getErrorCode(error);
    if (code === 'DEVICE_NOT_FOUND' || BLOCKED_CODES.has(code)) {
      handleAuthError(error);
      return;
    }
    // Explicit authorization failures are terminal even when a transport
    // wrapper incorrectly marks them retryable.
    const status = Number(error?.status);
    if (status === 401 || status === 403) {
      options.clearSession();
      options.setState(states.BLOCKED, code);
      return;
    }
    if (
      isRetryableAuthError(error) &&
      options.getState() === states.AUTHORIZED &&
      options.hasAccessToken() &&
      options.getTokenExpiresAt() > Date.now()
    )
      return;
    if (isRetryableAuthError(error)) handleAuthError(error);
  }

  return {
    handleAuthError,
    handleProtectedRequestError,
    isBlockedCode: (code) => BLOCKED_CODES.has(code),
  };
}

module.exports = { createLicenseErrorHandlers };
