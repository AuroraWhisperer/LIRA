'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const protocol = require('../src/electron/license/license-protocol');

const fingerprint = {
  version: 1,
  machineGuidHash: 'a'.repeat(64),
  smbiosUuidHash: 'b'.repeat(64),
  systemDriveHash: '',
};

const ACTIVATION_GOLDEN = [
  'LIRA_DEVICE_ACTIVATION_V2',
  'protocolVersion=2',
  'activationCodeSha256=9ac2197d9258257b1ae8463e4214e4cd0a578bc1517f2415928b91be4283fc48',
  'deviceName=DESKTOP-01',
  'platform=win32-x64',
  'appVersion=4.0.0',
  'buildId=LIRA/4.0.0/dev',
  'keyProtection=dpapi',
  'publicKeySha256=43a46f1d081d270130e2210a1de59f9715de033307d068edc65a335b27e95d3d',
  'fingerprintSha256=9657ba1b96df8405b3d9ece6dc09bce00bb669d9d6b6dac5e5e3159dd3d81412',
  'accountName=mlbb',
  'accountPasswordSha256=8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
].join('\n');

const AUTH_GOLDEN = [
  'LIRA_DEVICE_AUTH_V2',
  'protocolVersion=2',
  'deviceId=device-1234567890',
  'challengeId=challenge-123456',
  'nonce=nonce',
  'runtimeId=lira:12345678-1234-1234-1234-123456789012',
  'appVersion=4.0.0',
  'buildId=LIRA/4.0.0/dev',
  'integrityStatus=unverified',
  'fingerprintSha256=9657ba1b96df8405b3d9ece6dc09bce00bb669d9d6b6dac5e5e3159dd3d81412',
  'virtualization=0',
].join('\n');

test('activation and auth canonical payloads match the server golden vectors byte for byte', () => {
  const activation = protocol.buildActivationPayload({
    accountName: ' MLBB ',
    password: '123456',
    activationCode: 'abcd-efgh',
    deviceName: ' DESKTOP-01 ',
    platform: 'win32-x64',
    appVersion: '4.0.0',
    buildId: 'LIRA/4.0.0/dev',
    keyProtection: 'DPAPI',
    publicKeyPem: 'public-key',
    fingerprint,
  });
  assert.equal(activation, ACTIVATION_GOLDEN);

  const auth = protocol.buildAuthPayload({
    deviceId: 'device-1234567890',
    challengeId: 'challenge-123456',
    nonce: 'nonce',
    runtimeId: 'lira:12345678-1234-1234-1234-123456789012',
    appVersion: '4.0.0',
    buildId: 'LIRA/4.0.0/dev',
    integrityStatus: 'UNVERIFIED',
    fingerprint,
    virtualization: false,
  });
  assert.equal(auth, AUTH_GOLDEN);
});

test('P-256 signature verifies and changes to canonical input fail', () => {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const payload = protocol.buildAuthPayload({
    deviceId: 'd',
    challengeId: 'c',
    nonce: 'n',
    runtimeId: 'lira:r',
    fingerprint,
  });
  const signature = protocol.signPayload(payload, pair.privateKey);
  assert.equal(
    crypto.verify(
      'sha256',
      Buffer.from(payload),
      pair.publicKey,
      Buffer.from(signature, 'base64'),
    ),
    true,
  );
  assert.equal(
    crypto.verify(
      'sha256',
      Buffer.from(`${payload}x`),
      pair.publicKey,
      Buffer.from(signature, 'base64'),
    ),
    false,
  );
});

test('fingerprint requires at least two valid hashes', () => {
  assert.equal(protocol.countFingerprintValues(fingerprint), 2);
  assert.equal(
    protocol.countFingerprintValues({
      version: 1,
      machineGuidHash: 'not-a-hash',
    }),
    0,
  );
});
