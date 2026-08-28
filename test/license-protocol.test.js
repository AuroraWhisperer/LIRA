'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const protocol = require('../src/electron/license/license-protocol');

const fingerprint = {
  version: 1,
  machineGuidHash: 'a'.repeat(64),
  smbiosUuidHash: 'b'.repeat(64)
};

test('activation and auth canonical payloads are newline-delimited and deterministic', () => {
  const activation = protocol.buildActivationPayload({
    accountName: ' MLBB ',
    password: '123456',
    activationCode: 'abcd-efgh',
    deviceName: ' DESKTOP-01 ',
    platform: 'win32-x64',
    appVersion: '3.7.11',
    buildId: 'LIRA/dev',
    keyProtection: 'DPAPI',
    publicKeyPem: 'public-key',
    fingerprint
  });
  assert.match(activation, /^LIRA_DEVICE_ACTIVATION_V2\nprotocolVersion=2\n/);
  assert.match(activation, /activationCodeSha256=9ac2197d9258257b1ae8463e4214e4cd0a578bc1517f2415928b91be4283fc48/);
  assert.match(activation, /keyProtection=dpapi/);
  assert.match(activation, /accountName=mlbb/);
  assert.match(activation, /accountPasswordSha256=8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92/);
  assert.equal(activation.endsWith('\n'), false);

  const auth = protocol.buildAuthPayload({
    deviceId: 'device', challengeId: 'challenge', nonce: 'nonce', runtimeId: 'lira:runtime',
    appVersion: '3.7.11', buildId: 'LIRA/dev', integrityStatus: 'UNVERIFIED', fingerprint,
    virtualization: true
  });
  assert.match(auth, /integrityStatus=unverified/);
  assert.match(auth, /virtualization=1$/);
  assert.equal(auth.includes('\r'), false);
});

test('P-256 signature verifies and changes to canonical input fail', () => {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const payload = protocol.buildAuthPayload({ deviceId: 'd', challengeId: 'c', nonce: 'n', runtimeId: 'lira:r', fingerprint });
  const signature = protocol.signPayload(payload, pair.privateKey);
  assert.equal(crypto.verify('sha256', Buffer.from(payload), pair.publicKey, Buffer.from(signature, 'base64')), true);
  assert.equal(crypto.verify('sha256', Buffer.from(`${payload}x`), pair.publicKey, Buffer.from(signature, 'base64')), false);
});

test('fingerprint requires at least two valid hashes', () => {
  assert.equal(protocol.countFingerprintValues(fingerprint), 2);
  assert.equal(protocol.countFingerprintValues({ version: 1, machineGuidHash: 'not-a-hash' }), 0);
});
