'use strict';

const LicenseState = Object.freeze({
  CHECKING: 'checking',
  NEEDS_ACTIVATION: 'needs_activation',
  NEEDS_CONNECTION: 'needs_connection',
  AUTHORIZING: 'authorizing',
  AUTHORIZED: 'authorized',
  BLOCKED: 'blocked',
});

const REAUTHENTICATE_CODES = new Set([
  'DEVICE_SESSION_NOT_FOUND',
  'DEVICE_SESSION_INVALID',
  'DEVICE_TOKEN_INVALID',
]);

const RETRY_CHALLENGE_CODES = new Set([
  'CHALLENGE_EXPIRED',
  'CHALLENGE_NOT_FOUND',
  'CHALLENGE_ALREADY_USED',
  'CHALLENGE_MISMATCH',
]);

const RENEW_EARLY_MS = 90 * 1000;
const HEARTBEAT_INTERVAL_MS = 150 * 1000;
// Node timers clamp larger values to 1ms. Expiry checks still use the full
// absolute timestamp, while maintenance timers stay within this supported range.
const MAX_TIMER_DELAY_MS = 2_147_000_000;

module.exports = {
  LicenseState,
  REAUTHENTICATE_CODES,
  RETRY_CHALLENGE_CODES,
  RENEW_EARLY_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_TIMER_DELAY_MS,
};
