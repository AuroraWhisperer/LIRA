'use strict';

const os = require('node:os');
const {
  PROTOCOL_VERSION,
  normalizeFingerprint,
  countFingerprintValues,
  buildActivationPayload,
  buildAuthPayload,
  signPayload,
} = require('./license-protocol');
const { RemoteLicenseError } = require('./remote-license-error');
const { getErrorCode } = require('./license-response-utils');

const RETRY_CHALLENGE_CODES = new Set([
  'CHALLENGE_EXPIRED',
  'CHALLENGE_NOT_FOUND',
  'CHALLENGE_ALREADY_USED',
  'CHALLENGE_MISMATCH',
]);

async function requestDeviceActivation(options = {}) {
  const pending = options.keyStore.prepareActivation();
  const { keyPair } = pending;

  const proof = await collectDeviceProof(options);
  if (!proof || !options.isActive()) return null;
  const { fingerprint, build } = proof;
  const deviceName = String(options.deviceName || os.hostname())
    .trim()
    .slice(0, 100);
  const platform = `${process.platform}-${process.arch}`.slice(0, 40);
  const canonical = buildActivationPayload({
    ...options.validated,
    deviceName,
    platform,
    appVersion: build.appVersion,
    buildId: build.buildId,
    keyProtection: keyPair.keyProtection,
    publicKeyPem: keyPair.publicKeyPem,
    fingerprint,
  });
  pending.stage();
  const result = await options.remote.activate({
    protocolVersion: PROTOCOL_VERSION,
    code: options.validated.activationCode,
    accountName: options.validated.accountName,
    password: options.validated.password,
    deviceName,
    platform,
    appVersion: build.appVersion,
    buildId: build.buildId,
    publicKey: keyPair.publicKeyPem,
    activationSignature: signPayload(canonical, keyPair.privateKeyPem),
    keyProtection: keyPair.keyProtection,
    integrityStatus: build.integrityStatus,
    fingerprint,
  });
  if (!options.isActive()) return null;
  if (!result?.deviceId)
    throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', { retryable: true });

  pending.commit();
  return {
    keyPair,
    result,
    complete: pending.complete,
    identity: {
      deviceId: result.deviceId,
      licenseId: result.licenseId,
      streamerId: result.streamerId,
      accountName: options.validated.accountName,
      subdomain: result.streamer?.subdomain || options.validated.accountName,
      publicKeyPem: keyPair.publicKeyPem,
      keyProtection: keyPair.keyProtection,
      deviceName,
      createdAt: new Date().toISOString(),
    },
  };
}

async function collectDeviceProof({ fingerprintProvider, buildInfoProvider, isActive }) {
  const fingerprint = normalizeFingerprint(await fingerprintProvider.collect());
  if (!isActive()) return null;
  if (countFingerprintValues(fingerprint) < 2)
    throw new RemoteLicenseError('FINGERPRINT_UNAVAILABLE', '无法读取足够的设备标识，暂时无法完成绑定。');

  const build = await buildInfoProvider();
  if (!isActive()) return null;
  return { fingerprint, build };
}

async function requestDeviceAuthentication({
  identity, privateKeyPem, runtimeId, renewalSessionId, virtualization,
  remote, fingerprintProvider, buildInfoProvider, isActive, attempt = 0,
}) {
  if (!isActive()) return null;
  const proof = await collectDeviceProof({ fingerprintProvider, buildInfoProvider, isActive });
  if (!proof || !isActive()) return null;
  const { fingerprint, build } = proof;
  const challenge = await remote.challenge({
    deviceId: identity.deviceId,
  });
  if (!isActive()) return null;
  const canonical = buildAuthPayload({
    protocolVersion: PROTOCOL_VERSION,
    deviceId: identity.deviceId,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    runtimeId,
    appVersion: build.appVersion,
    buildId: build.buildId,
    integrityStatus: build.integrityStatus,
    fingerprint,
    virtualization: Boolean(virtualization),
  });
  let result;
  try {
    result = await remote.verify({
      protocolVersion: PROTOCOL_VERSION,
      deviceId: identity.deviceId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      signature: signPayload(canonical, privateKeyPem),
      runtimeId,
      appVersion: build.appVersion,
      buildId: build.buildId,
      integrityStatus: build.integrityStatus,
      fingerprint,
      environment: { virtualization: Boolean(virtualization) },
      ...(renewalSessionId ? { renewalSessionId } : {}),
    });
  } catch (error) {
    if (RETRY_CHALLENGE_CODES.has(getErrorCode(error)) && attempt < 1) {
      return requestDeviceAuthentication({
        identity, privateKeyPem, runtimeId, renewalSessionId, virtualization,
        remote, fingerprintProvider, buildInfoProvider, isActive, attempt: attempt + 1,
      });
    }
    throw error;
  }
  return isActive() ? result : null;
}

function createDeviceAuthEndpoints({ request }) {
  return {
    activate: (body) => request('POST', '/api/device/activate', body),
    challenge: (body) => request('POST', '/api/device/challenge', body),
    verify: (body) => request('POST', '/api/device/verify', body),
    heartbeat: (token) => request('POST', '/api/device/heartbeat', {}, token),
  };
}

module.exports = { requestDeviceActivation, requestDeviceAuthentication, createDeviceAuthEndpoints };
