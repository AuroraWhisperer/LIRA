'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSensitiveFieldName } = require('../src/shared/sensitive-field-name');
const { redactCredentials } = require('../src/shared/log-redaction');
const { isSensitiveResponseKey, sanitizeRemoteResponse, addSongBackgroundPreviewUrl } = require('../src/electron/license/license-response-utils');

const sensitive = ['password', 'PASSWD', 'key', 'activation_code', 'pairing-code',
  'fingerprint', 'HardwareId', 'Authorization', 'Cookie', 'apiKey', 'client-secret',
  'access_token', 'activationSignature', 'PRIVATE_KEY_PEM'];
const publicNames = ['accountName', 'deviceName', 'state', 'tokenCount', 'keyboard', 'secretCount', 'roomId'];

test('sensitive field policy is shared while masking and removal remain separate', () => {
  assert.equal(isSensitiveResponseKey, isSensitiveFieldName);
  for (const key of [...sensitive, ...publicNames]) {
    const secret = sensitive.includes(key);
    assert.equal(isSensitiveFieldName(key), secret, key);
    const input = { nested: [{ [key]: 'synthetic-value' }] };
    const logged = redactCredentials(input).nested[0];
    const response = sanitizeRemoteResponse(input).nested[0];
    assert.equal(logged[key], secret ? '[REDACTED]' : 'synthetic-value');
    assert.equal(Object.hasOwn(response, key), !secret);
    assert.equal(input.nested[0][key], 'synthetic-value');
  }
});

test('URI decoding remains with log and URL consumers, not plain response keys', () => {
  const encoded = 'access%54oken';
  assert.equal(isSensitiveFieldName(encoded), false);
  assert.equal(redactCredentials({ [encoded]: 'synthetic' })[encoded], '[REDACTED]');
  assert.equal(sanitizeRemoteResponse({ [encoded]: 'synthetic' })[encoded], 'synthetic');
  assert.equal(redactCredentials('https://example.test/?access%54oken=synthetic'),
    'https://example.test/?access%54oken=[REDACTED]');
  assert.throws(() => addSongBackgroundPreviewUrl({ background: { url: '/background?access%54oken=synthetic' } }, 'https://example.test'), { code: 'BACKGROUND_URL_INVALID' });
  assert.doesNotThrow(() => redactCredentials({ 'bad%encoding': 'public' }));
});
