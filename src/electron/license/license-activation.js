'use strict';

const os = require('node:os');
const {
  PROTOCOL_VERSION,
  normalizeFingerprint,
  countFingerprintValues,
  buildActivationPayload,
  signPayload,
} = require('./license-protocol');
const { RemoteLicenseError } = require('./remote-license-client');

async function requestDeviceActivation(options = {}) {
  const pending = options.keyStore.prepareActivation();
  const { keyPair } = pending;

  const fingerprint = normalizeFingerprint(
    await options.fingerprintProvider.collect(),
  );
  if (!options.isActive()) return null;
  if (countFingerprintValues(fingerprint) < 2)
    throw new RemoteLicenseError(
      'FINGERPRINT_UNAVAILABLE',
      '无法读取足够的设备标识，暂时无法完成绑定。',
    );

  const build = options.buildInfoProvider();
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
    throw new RemoteLicenseError(
      'INVALID_RESPONSE',
      '授权服务器返回无效响应。',
      { retryable: true },
    );

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

module.exports = { requestDeviceActivation };
