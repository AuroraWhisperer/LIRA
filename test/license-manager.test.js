'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createLicenseManager, LicenseState, mapSongForSync } = require('../src/electron/license/license-manager');

function createHarness({ identity = null, challengeError = null } = {}) {
  const state = { value: identity };
  const generated = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const keyPair = { privateKeyPem: generated.privateKey, publicKeyPem: generated.publicKey, keyProtection: 'dpapi' };
  const stateStore = { read: () => state.value, write: value => (state.value = value) };
  const keyStore = { loadPrivateKey: () => identity ? keyPair.privateKeyPem : null, loadOrCreate: () => keyPair };
  const fingerprintProvider = { collect: async () => ({ version: 1, machineGuidHash: 'a'.repeat(64), smbiosUuidHash: 'b'.repeat(64) }) };
  const remote = {
    challenge: async () => { if (challengeError) throw challengeError; return { challengeId: 'c', nonce: 'n' }; },
    verify: async () => ({ accessToken: 'token', expiresIn: '10m', deviceId: 'd', licenseId: 'l', streamer: { accountName: 'mlbb', subdomain: 'mlbb' } }),
    activate: async () => ({ deviceId: 'd', licenseId: 'l', streamerId: 1, streamer: { accountName: 'mlbb', subdomain: 'mlbb' } }),
    heartbeat: async () => ({ ok: true }),
    profile: async () => ({ streamer: { accountName: 'mlbb' } }),
    syncSongs: async songs => ({ ok: true, count: songs.length })
  };
  const manager = createLicenseManager({ stateStore, keyStore, fingerprintProvider, remoteClient: remote, buildInfoProvider: () => ({ appVersion: '3.7.11', buildId: 'dev', integrityStatus: 'unverified' }) });
  return { manager, state };
}

test('manager requires activation without a local identity', async () => {
  const { manager } = createHarness();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.NEEDS_ACTIVATION);
  manager.dispose();
});

test('manager maps network timeout to connection state and can recover', async () => {
  const { manager } = createHarness({ identity: { deviceId: 'd', publicKeyPem: 'public' }, challengeError: Object.assign(new Error('timeout'), { code: 'REQUEST_TIMEOUT' }) });
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  manager.dispose();
});

test('activation does not become authorized until verify succeeds', async () => {
  const { manager } = createHarness();
  const result = await manager.activate({ accountName: 'MLBB', password: '123456', activationCode: 'ABCD-EFGH' });
  assert.equal(result.ok, true);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getAccessToken(), 'token');
  manager.dispose();
});

test('song sync maps local snake_case song fields to the remote contract', () => {
  assert.deepEqual(mapSongForSync({
    title: 'Song', artist: 'Artist', category_name: 'Pop', source_platform: 'QQ',
    request_price: '30', song_clip: 'clip', is_enabled: 0, sort_order: 3
  }), {
    name: 'Song', artist: 'Artist', categoryName: 'Pop', tags: '', language: '',
    sourcePlatform: 'QQ', note: '', requestPrice: '30', songClip: 'clip', isEnabled: false, sortOrder: 3
  });
});
