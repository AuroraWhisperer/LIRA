'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const protocol = require('../../src/electron/license/license-protocol');
const { readServerFixture } = require('../../scripts/verify-server-contract');
const vectors = readServerFixture('docs/protocol/fixtures/device-auth-v2-vectors.json');

test('activation validation and signing preserve spaces and Unicode in the password', () => {
  const password = '  歌手Aa1!😀  ';
  const result = protocol.validateActivationInput({
    accountName: 'sample-account',
    password,
    activationCode: 'SYNTHETIC-CODE',
  });
  assert.equal(result.ok, true);
  assert.equal(result.password, password);
  const digest = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
  assert.ok(
    protocol.buildActivationPayload({ ...result, fingerprint: {} }).endsWith(`accountPasswordSha256=${digest}`),
  );
});

const fingerprint = {
  version: 1,
  machineGuidHash: 'a'.repeat(64),
  smbiosUuidHash: 'b'.repeat(64),
  systemDriveHash: '',
};

test('activation and auth canonical payloads match the server golden vectors byte for byte', () => {
  for (const sample of [vectors, vectors.normalization]) {
    const { code, accountPassword, ...input } = sample.activation.input;
    const activation = protocol.buildActivationPayload({
      ...input,
      activationCode: code,
      password: accountPassword,
    });
    assert.equal(activation, sample.activation.expectedCanonicalPayload);
    assert.equal(protocol.buildAuthPayload(sample.challenge.input), sample.challenge.expectedCanonicalPayload);
  }
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
  assert.equal(crypto.verify('sha256', Buffer.from(payload), pair.publicKey, Buffer.from(signature, 'base64')), true);
  assert.equal(
    crypto.verify('sha256', Buffer.from(`${payload}x`), pair.publicKey, Buffer.from(signature, 'base64')),
    false,
  );
});

test('activation canonical payload normalizes generated SPKI PEM whitespace', () => {
  const generated = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  assert.equal(generated.publicKey.endsWith('\n'), true);

  const input = {
    accountName: 'mlbb',
    password: '123456',
    activationCode: 'abcd-efgh',
    deviceName: 'DESKTOP-01',
    platform: 'win32-x64',
    appVersion: '4.0.0',
    buildId: 'LIRA/4.0.0/dev',
    keyProtection: 'dpapi',
    fingerprint,
  };
  const clientPayload = protocol.buildActivationPayload({
    ...input,
    publicKeyPem: generated.publicKey,
  });
  const serverBoundaryPayload = protocol.buildActivationPayload({
    ...input,
    publicKeyPem: generated.publicKey.trim(),
  });

  assert.equal(clientPayload, serverBoundaryPayload);
  const signature = protocol.signPayload(clientPayload, generated.privateKey);
  assert.equal(
    crypto.verify(
      'sha256',
      Buffer.from(serverBoundaryPayload, 'utf8'),
      generated.publicKey,
      Buffer.from(signature, 'base64'),
    ),
    true,
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
