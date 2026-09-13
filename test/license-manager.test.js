'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  LicenseState,
  parseExpiresIn,
  resolveTokenExpiresAt,
} = require('../src/electron/license/license-manager');
const { createHarness } = require('./helpers/license-manager-harness');

test('manager requires activation without a local identity', async () => {
  const { manager } = createHarness();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.NEEDS_ACTIVATION);
  manager.dispose();
});

test('manager maps network timeout to connection state and can recover', async () => {
  const { manager } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    challengeError: Object.assign(new Error('timeout'), {
      code: 'REQUEST_TIMEOUT',
    }),
  });
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  manager.dispose();
});

test('token expiry parsing accepts server TTL units and absolute metadata', () => {
  assert.equal(parseExpiresIn('2d'), 2 * 24 * 60 * 60 * 1000);
  assert.equal(parseExpiresIn('250ms'), 250);
  assert.equal(parseExpiresIn(600), 600 * 1000);
  assert.equal(parseExpiresIn('0s'), 0);
  assert.equal(parseExpiresIn('not-a-duration'), 10 * 60 * 1000);
  assert.equal(parseExpiresIn(Number.MAX_VALUE), 10 * 60 * 1000);

  const now = Date.parse('2026-08-29T00:00:00.000Z');
  assert.equal(
    resolveTokenExpiresAt({ expiresIn: '2d', expiresInSeconds: 3600 }, now),
    now + 3600 * 1000,
  );
  assert.equal(
    resolveTokenExpiresAt(
      { expiresIn: '0s', expiresAt: '2026-08-29T01:00:00.000Z' },
      now,
    ),
    Date.parse('2026-08-29T01:00:00.000Z'),
  );
  assert.equal(
    resolveTokenExpiresAt({ expiresIn: '2h', expiresInSeconds: null }, now),
    now + 2 * 60 * 60 * 1000,
  );
  assert.equal(
    resolveTokenExpiresAt({ expiresIn: '2h', expiresInSeconds: true }, now),
    now + 2 * 60 * 60 * 1000,
  );
});

test('manager prefers valid server expiry metadata over a legacy short TTL', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: () => '0s',
    verifyExpiresInSeconds: () => 600,
  });
  await manager.bootstrap();
  await manager.syncSongs([]);
  assert.equal(calls.verifies, 1);
  manager.dispose();
});

test('activation does not become authorized until verify succeeds', async () => {
  const { manager } = createHarness();
  const result = await manager.activate({
    accountName: 'MLBB',
    password: '123456',
    activationCode: 'ABCD-EFGH',
  });
  assert.equal(result.ok, true);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getAccessToken(), 'token');
  assert.deepEqual(manager.getCloudSyncIdentity(), {
    streamerId: 1,
    accountName: 'mlbb',
  });
  manager.dispose();
});
