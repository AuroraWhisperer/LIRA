'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { digest, sanitizeSettings } = require('../../src/shared/daily-bot-contract');
const { readServerFixture } = require('../../scripts/verify-server-contract');
const fixture = readServerFixture('docs/protocol/fixtures/daily-bots-v1.json');

// Controller, IPC and migration behaviour run offline in daily-bot-takeover.test.js.
test('shared snapshot bytes agree with server fixture and settings strip extra fields', () => {
  assert.equal(digest(fixture.snapshot), fixture.digest);
  assert.deepEqual(sanitizeSettings({ ...fixture.defaultResponse, token: 'private' }), fixture.defaultResponse);
  assert.throws(() => sanitizeSettings({ ...fixture.defaultResponse, checkin: { enabled: true } }), /INVALID_RESPONSE/);
});
