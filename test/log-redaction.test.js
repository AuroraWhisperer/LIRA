'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { redactCredentials } = require('../src/shared/log-redaction');

test('object redaction covers every license-protocol sensitive field', () => {
  const input = {
    accountName: 'mlbb',
    password: '123456',
    activationCode: 'ABCD-EFGH-IJKL-MNOP',
    pairingCode: 'PAIR-1234',
    accessToken: 'jwt-access-token',
    refreshToken: 'jwt-refresh-token',
    signature: 'sig-value',
    activationSignature: 'activation-sig-value',
    privateKey: 'pem-body',
    privateKeyPem: '-----BEGIN PRIVATE KEY-----',
    fingerprint: 'raw-machine-guid',
    hardwareId: 'HW-ID-123',
    deviceName: 'MY-PC',
    state: 'authorized',
  };

  const out = redactCredentials(input);

  for (const key of [
    'password',
    'activationCode',
    'pairingCode',
    'accessToken',
    'refreshToken',
    'signature',
    'activationSignature',
    'privateKey',
    'privateKeyPem',
    'fingerprint',
    'hardwareId',
  ]) {
    assert.equal(out[key], '[REDACTED]', `${key} must be redacted`);
  }
  assert.equal(out.accountName, 'mlbb');
  assert.equal(out.deviceName, 'MY-PC');
  assert.equal(out.state, 'authorized');
  assert.equal(input.password, '123456', 'redaction must not mutate the input');
});

test('nested objects and arrays are redacted recursively', () => {
  const out = redactCredentials({
    payload: { activationCode: 'SECRET-CODE', note: 'ok' },
    attempts: [{ token: 't1' }, { token: 't2' }],
  });
  assert.equal(out.payload.activationCode, '[REDACTED]');
  assert.equal(out.payload.note, 'ok');
  assert.deepEqual(out.attempts, [
    { token: '[REDACTED]' },
    { token: '[REDACTED]' },
  ]);
});

test('error redaction strips credentials from message and stack', () => {
  const error = new Error(
    'verify failed: https://lirahub.cn/api/device/verify?signature=SIGVALUE&token=abc123&state=retry',
  );
  const out = redactCredentials(error);
  assert.ok(
    !out.message.includes('SIGVALUE'),
    'signature must be redacted from error message',
  );
  assert.ok(
    !out.message.includes('abc123'),
    'token must be redacted from error message',
  );
  assert.ok(
    out.message.includes('state=retry'),
    'non-sensitive params must survive',
  );
});

test('string redaction covers activation and pairing codes in URLs', () => {
  const out = redactCredentials(
    'POST https://lirahub.cn/api/device/activate?activationCode=SECRET-CODE&pairingCode=PAIR-9&privateKey=PEM&state=ok',
  );
  assert.ok(!out.includes('SECRET-CODE'));
  assert.ok(!out.includes('PAIR-9'));
  assert.ok(!out.includes('PEM'));
  assert.ok(out.includes('state=ok'));
});

test('snake_case credential fields cannot bypass redaction', () => {
  const object = redactCredentials({
    private_key: 'PEM',
    activation_code: 'ACTIVATION',
    access_token: 'ACCESS',
    hardware_id: 'HARDWARE',
    note: 'keep',
  });
  for (const key of [
    'private_key',
    'activation_code',
    'access_token',
    'hardware_id',
  ]) {
    assert.equal(object[key], '[REDACTED]', `${key} must be redacted`);
  }
  assert.equal(object.note, 'keep');

  const string = redactCredentials(
    'GET https://example.test/?private_key_pem=PEM&activation_code=ACTIVATION&accessToken=ACCESS&access%5Ftoken=ENCODED&state=ok',
  );
  for (const value of ['PEM', 'ACTIVATION', 'ACCESS', 'ENCODED'])
    assert.ok(!string.includes(value));
  assert.ok(string.includes('state=ok'));
});

test('URL object redaction covers license params and keeps others', () => {
  const url = new URL(
    'https://lirahub.cn/api/device/pairing-codes?activationCode=SECRET-CODE&signature=SIG&page=2',
  );
  const out = redactCredentials(url);
  assert.ok(!out.includes('SECRET-CODE'));
  assert.ok(!out.includes('SIG'));
  assert.ok(out.includes('page=2'));
});

test('URL object redaction handles userinfo and license params together', () => {
  const url = new URL(
    'https://user:password@lirahub.cn/api/device/activate?activationCode=SECRET-CODE&signature=SIG&page=2',
  );
  const out = redactCredentials(url);
  assert.ok(!out.includes('user:password'));
  assert.ok(!out.includes('SECRET-CODE'));
  assert.ok(!out.includes('SIG'));
  assert.ok(out.includes('page=2'));
});

test('URL object redaction covers token variants and private-key fields', () => {
  const url = new URL(
    'https://lirahub.cn/api/device/verify?access_token=ACCESS&refresh_token=REFRESH&private_key_pem=PEM&state=ok',
  );
  const out = redactCredentials(url);
  for (const value of ['ACCESS', 'REFRESH', 'PEM'])
    assert.ok(!out.includes(value));
  assert.ok(out.includes('state=ok'));
});

test('authorization and cookie headers stay redacted', () => {
  assert.equal(
    redactCredentials('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'),
    'Authorization: Bearer [REDACTED]',
  );
  assert.ok(!redactCredentials('Cookie: lira_admin=abc123').includes('abc123'));
});
