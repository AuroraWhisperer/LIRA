'use strict';

const crypto = require('node:crypto');
const {
  createLicenseManager,
} = require('../../src/electron/license/license-manager');

function createHarness({
  identity = null,
  challengeError = null,
  verifyExpiresIn = () => '10m',
  verifyExpiresInSeconds = () => undefined,
  verifyExpiresAt = () => undefined,
  timers,
} = {}) {
  const state = { value: identity };
  const backgroundCalls = [];
  const calls = {
    challenges: 0,
    verifies: 0,
    heartbeatTokens: [],
    syncTokens: [],
    catalog: [],
    giftEventRequests: [],
    giftEventOptions: [],
    giftHistoryRequests: [],
    giftHistoryClearRequests: [],
    giftWatchRequests: [],
  };
  const generated = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyPair = {
    privateKeyPem: generated.privateKey,
    publicKeyPem: generated.publicKey,
    keyProtection: 'dpapi',
  };
  const stateStore = {
    read: () => state.value,
    write: (value) => (state.value = value),
  };
  const keyStore = {
    loadPrivateKey: () => (identity ? keyPair.privateKeyPem : null),
    prepareActivation: () => ({ keyPair, stage() {}, commit() {}, complete() {} }),
  };
  const fingerprintProvider = {
    collect: async () => ({
      version: 1,
      machineGuidHash: 'a'.repeat(64),
      smbiosUuidHash: 'b'.repeat(64),
    }),
  };
  const remote = {
    baseUrl: 'https://api.example.test',
    challenge: async () => {
      calls.challenges += 1;
      if (challengeError) throw challengeError;
      return { challengeId: `c${calls.challenges}`, nonce: 'n' };
    },
    verify: async () => {
      calls.verifies += 1;
      const accessToken =
        calls.verifies === 1 ? 'token' : `token-${calls.verifies}`;
      const result = {
        accessToken,
        sessionId: 'session-1',
        expiresIn: verifyExpiresIn(calls.verifies),
        deviceId: 'd',
        licenseId: 'l',
        streamer: { accountName: 'mlbb', subdomain: 'mlbb' },
      };
      const expiresInSeconds = verifyExpiresInSeconds(calls.verifies);
      const expiresAt = verifyExpiresAt(calls.verifies);
      if (expiresInSeconds !== undefined)
        result.expiresInSeconds = expiresInSeconds;
      if (expiresAt !== undefined) result.expiresAt = expiresAt;
      return result;
    },
    activate: async () => ({
      deviceId: 'd',
      licenseId: 'l',
      streamerId: 1,
      streamer: { accountName: 'mlbb', subdomain: 'mlbb' },
    }),
    heartbeat: async (token) => {
      calls.heartbeatTokens.push(token);
      return { ok: true };
    },
    profile: async () => ({ streamer: { accountName: 'mlbb' } }),
    syncSongs: async (songs, token) => {
      calls.syncTokens.push(token);
      return { ok: true, count: songs.length };
    },
    getCloudSongs: async (token) => {
      calls.cloudSongsTokens = calls.cloudSongsTokens || [];
      calls.cloudSongsTokens.push(token);
      return { songs: [{ name: '云端歌' }] };
    },
    getGiftCatalog: async (etag, token) => {
      calls.catalog.push({ etag, token });
      return {
        ok: true,
        version: 'catalog-1',
        gifts: [
          {
            id: '100',
            name: '服务器礼物',
            imageUrl: '/gift-media/images/hash.webp',
          },
        ],
        etag: '"catalog-1"',
      };
    },
    getGiftEvents: async (after, limit, token, options) => {
      calls.giftEventRequests.push({ after, limit, token });
      calls.giftEventOptions.push(options);
      return { ok: true, events: [], nextCursor: after ?? 0, hasMore: false };
    },
    getGiftHistory: async (pageToken, token, options) => {
      calls.giftHistoryRequests.push({ pageToken, token, options });
      return {
        ok: true,
        events: [],
        nextPageToken: null,
        hasMore: false,
        recoveryCursor: 4,
        syncEpoch: 'epoch-1',
        historyBootstrapVersion: 1,
      };
    },
    clearGiftHistory: async (token, options) => {
      calls.giftHistoryClearRequests.push({ token, options });
      return {
        ok: true,
        deletedCounts: { giftEvents: 12, giftEventDeliveries: 10 },
        syncEpoch: 'epoch-2',
      };
    },
    watchGiftEvents: async (token, options) => {
      calls.giftWatchRequests.push({ token, options });
    },
    getSongPageBackground: async (token) => ({
      ok: true,
      background: { url: '/background.png' },
      token,
    }),
    uploadSongPageBackground: async (bytes, contentType, token) => {
      backgroundCalls.push({ bytes, contentType, token });
      return { ok: true, background: { url: '/background.png' } };
    },
    deleteSongPageBackground: async (token) => ({
      ok: true,
      background: null,
      token,
    }),
  };
  const manager = createLicenseManager({
    stateStore,
    keyStore,
    fingerprintProvider,
    remoteClient: remote,
    timers,
    buildInfoProvider: () => ({
      appVersion: '3.7.11',
      buildId: 'dev',
      integrityStatus: 'unverified',
    }),
  });
  return { manager, state, backgroundCalls, calls, remote };
}

module.exports = { createHarness };
