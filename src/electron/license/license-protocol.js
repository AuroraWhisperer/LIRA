'use strict';

const crypto = require('node:crypto');

const PROTOCOL_VERSION = 2;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeActivationCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeAccountName(value) {
  return String(value || '').trim().toLowerCase();
}

function validateActivationInput(input = {}) {
  const accountName = normalizeAccountName(input.accountName);
  const password = String(input.password || '');
  const activationCode = String(input.activationCode || '').trim();

  if (accountName.length < 2 || accountName.length > 32) return { ok: false, error: 'ACCOUNT_NAME_LENGTH' };
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(accountName)) return { ok: false, error: 'ACCOUNT_NAME_INVALID' };
  if (password.length < 6) return { ok: false, error: 'PASSWORD_TOO_SHORT' };
  if (password.length > 128) return { ok: false, error: 'PASSWORD_TOO_LONG' };
  if (!activationCode || normalizeActivationCode(activationCode).length < 4) return { ok: false, error: 'ACTIVATION_CODE_INVALID' };
  return { ok: true, accountName, password, activationCode };
}

function normalizeFingerprint(fingerprint = {}) {
  const version = Number(fingerprint.version) || 1;
  return {
    version,
    machineGuidHash: normalizeHash(fingerprint.machineGuidHash),
    smbiosUuidHash: normalizeHash(fingerprint.smbiosUuidHash),
    systemDriveHash: normalizeHash(fingerprint.systemDriveHash)
  };
}

function normalizeHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function countFingerprintValues(fingerprint) {
  const value = normalizeFingerprint(fingerprint);
  return ['machineGuidHash', 'smbiosUuidHash', 'systemDriveHash']
    .filter(key => Boolean(value[key])).length;
}

function buildFingerprintDigest(fingerprint) {
  const value = normalizeFingerprint(fingerprint);
  return sha256([
    `v=${value.version}`,
    `machineGuid=${value.machineGuidHash || '-'}`,
    `smbiosUuid=${value.smbiosUuidHash || '-'}`,
    `systemDrive=${value.systemDriveHash || '-'}`
  ].join('\n'));
}

function buildActivationPayload(input = {}) {
  const accountName = normalizeAccountName(input.accountName);
  const fingerprint = normalizeFingerprint(input.fingerprint);
  return [
    'LIRA_DEVICE_ACTIVATION_V2',
    `protocolVersion=${PROTOCOL_VERSION}`,
    `activationCodeSha256=${sha256(normalizeActivationCode(input.activationCode))}`,
    `deviceName=${String(input.deviceName || '').trim().slice(0, 100)}`,
    `platform=${String(input.platform || '').trim().slice(0, 40)}`,
    `appVersion=${String(input.appVersion || '').trim().slice(0, 40)}`,
    `buildId=${String(input.buildId || '').trim().slice(0, 120)}`,
    `keyProtection=${String(input.keyProtection || '').trim().toLowerCase().slice(0, 20)}`,
    `publicKeySha256=${sha256(input.publicKeyPem || '')}`,
    `fingerprintSha256=${buildFingerprintDigest(fingerprint)}`,
    `accountName=${accountName.slice(0, 32)}`,
    `accountPasswordSha256=${sha256(String(input.password || ''))}`
  ].join('\n');
}

function buildAuthPayload(input = {}) {
  const fingerprint = normalizeFingerprint(input.fingerprint);
  return [
    'LIRA_DEVICE_AUTH_V2',
    `protocolVersion=${PROTOCOL_VERSION}`,
    `deviceId=${String(input.deviceId || '').trim().slice(0, 128)}`,
    `challengeId=${String(input.challengeId || '').trim().slice(0, 128)}`,
    `nonce=${String(input.nonce || '').trim().slice(0, 256)}`,
    `runtimeId=${String(input.runtimeId || '').trim().slice(0, 128)}`,
    `appVersion=${String(input.appVersion || '').trim().slice(0, 40)}`,
    `buildId=${String(input.buildId || '').trim().slice(0, 120)}`,
    `integrityStatus=${String(input.integrityStatus || '').trim().toLowerCase().slice(0, 20)}`,
    `fingerprintSha256=${buildFingerprintDigest(fingerprint)}`,
    `virtualization=${input.virtualization ? 1 : 0}`
  ].join('\n');
}

function signPayload(payload, privateKeyPem) {
  return crypto.sign('sha256', Buffer.from(String(payload), 'utf8'), privateKeyPem).toString('base64');
}

module.exports = {
  PROTOCOL_VERSION,
  sha256,
  normalizeActivationCode,
  normalizeAccountName,
  validateActivationInput,
  normalizeFingerprint,
  countFingerprintValues,
  buildFingerprintDigest,
  buildActivationPayload,
  buildAuthPayload,
  signPayload
};
