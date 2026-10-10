'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createLicenseIpcFixture } = require('../helpers/license-ipc-fixture');

const PUBLIC_STREAMER = { accountName: 'mlbb', displayName: 'mlbb', subdomain: '' };
const PUBLIC_DEVICE = { id: 'd', name: '', status: '', licenseId: '' };

test('current-library IPC passes only a confirmation generation and sanitizes the result', async () => {
  const calls = [];
  const ipc = createLicenseIpcFixture({
    licenseManager: { getCloudSongCount: async () => ({ count: 2, private: 'hidden' }) },
    cloudSyncController: {
      getLocalSongCount: () => ({ count: 3, generation: 4, internal: 'private' }),
      syncCurrentSongs: async (generation) => {
        calls.push(generation);
        return { ok: true, count: 3, revision: 12, accessToken: 'private' };
      },
    },
  });
  assert.deepEqual(await ipc.invoke('license:get-local-song-count'), { ok: true, count: 3, generation: 4 });
  assert.deepEqual(await ipc.invoke('license:get-cloud-song-count'), { ok: true, count: 2 });
  assert.deepEqual(await ipc.invoke('license:sync-current-songs', 4), { ok: true, count: 3 });
  assert.equal((await ipc.invoke('license:sync-current-songs', [])).error, 'CLOUD_SONGS_CHANGED');
  assert.equal((await ipc.handlers.get('license:sync-current-songs')(ipc.eventFrom('https://evil.test'), 4)).error, 'IPC_SOURCE_INVALID');
  assert.deepEqual(calls, [4]);
});

test('license IPC allowlists remote responses before crossing into the renderer', async () => {
  let stateListener = null;
  const ipc = createLicenseIpcFixture({
    licenseManager: {
      getSnapshot: () => ({
        state: 'authorized',
        error: 'accessToken=should-not-cross',
        streamer: {
          accountName: 'mlbb',
          songPageUrl: 'http://127.0.0.1:13000/songs',
          manageUrl: 'https://127.0.0.1/manage',
          token: 'drop',
        },
        device: { id: 'd', privateKeyPem: 'drop' },
        accessToken: 'drop',
      }),
      activate: async () => ({
        ok: true,
        state: 'authorized',
        streamer: { accountName: 'mlbb', accessToken: 'drop' },
        privateKeyPem: 'drop',
      }),
      retry: async () => {},
      getProfile: async () => ({
        state: 'authorized',
        error: 'privateKeyPem=should-not-cross',
        streamer: { accountName: 'mlbb', token: 'drop' },
        device: { id: 'd', privateKey: 'drop' },
        accessToken: 'drop',
      }),
      syncSongs: async () => ({
        ok: true,
        count: 2,
        songPageUrl: 'https://songs.example.test/?token=drop',
        accessToken: 'drop',
        nested: { safe: 'drop-unknown' },
      }),
      getCloudSongs: async () => ({
        songs: [
          {
            title: 'Song',
            artist: 'Artist',
            accessToken: 'drop',
            nested: { privateKeyPem: 'drop' },
          },
        ],
        token: 'drop',
      }),
      getSongPageBackground: async () => ({
        ok: true,
        background: {
          url: '/background.png?token=drop',
          bytes: 12,
          updatedAt: '2026-08-29T00:00:00.000Z',
          previewUrl: 'https://api.example.test/background.png?private_key_pem=drop',
        },
        accessToken: 'drop',
      }),
      uploadSongPageBackground: async () => ({
        ok: true,
        background: {
          url: '/background.png',
          bytes: 12,
          updatedAt: '2026-08-29T00:00:00.000Z',
          previewUrl: 'https://api.example.test/background.png',
        },
        privateKeyPem: 'drop',
      }),
      deleteSongPageBackground: async () => ({
        ok: true,
        background: null,
        token: 'drop',
      }),
      onStateChanged: (listener) => {
        stateListener = listener;
        return () => {};
      },
    },
  });
  const { handlers, licenseManager } = ipc;

  assert.equal(handlers.has('license:create-pairing-code'), false);
  assert.equal(handlers.has('license:list-pairing-codes'), false);
  assert.equal(handlers.has('license:revoke-pairing-code'), false);

  assert.deepEqual(await ipc.invoke('license:sync-songs', []), {
    ok: true,
    count: 2,
  });
  assert.deepEqual(
    await ipc.invoke('license:activate', {
      accountName: 'mlbb',
      password: 'password',
      activationCode: 'ACTIVATE',
    }),
    { ok: true, state: 'authorized', streamer: PUBLIC_STREAMER },
  );
  assert.deepEqual(await ipc.invoke('license:retry'), {
    ok: true,
    state: 'authorized',
    error: 'LICENSE_ERROR',
    streamer: PUBLIC_STREAMER,
    device: PUBLIC_DEVICE,
  });
  assert.deepEqual(await ipc.invoke('license:get-cloud-songs'), {
    songs: [{ title: 'Song', artist: 'Artist' }],
  });
  assert.deepEqual(await ipc.invoke('license:get-song-page-background'), {
    ok: true,
    background: { bytes: 12, updatedAt: '2026-08-29T00:00:00.000Z' },
  });
  assert.deepEqual(
    await ipc.invoke('license:upload-song-page-background', {
      bytes: new Uint8Array([1]),
      fileName: 'cover.png',
    }),
    {
      ok: true,
      background: {
        url: '/background.png',
        bytes: 12,
        updatedAt: '2026-08-29T00:00:00.000Z',
        previewUrl: 'https://api.example.test/background.png',
      },
    },
  );
  assert.deepEqual(await ipc.invoke('license:delete-song-page-background'), {
    ok: true,
    background: null,
  });

  licenseManager.syncSongs = async () => ({ ok: false, count: 0, index: 2 });
  assert.deepEqual(await ipc.invoke('license:sync-songs', []), {
    ok: false,
    count: 0,
    index: 2,
  });
  licenseManager.syncSongs = async () => ({
    ok: false,
    count: 0,
    index: '2',
  });
  assert.deepEqual(await ipc.invoke('license:sync-songs', []), {
    ok: false,
    count: 0,
  });
  licenseManager.syncSongs = async () => {
    const error = new Error('INVALID_SONG');
    error.code = 'INVALID_SONG';
    error.index = 2;
    throw error;
  };
  assert.deepEqual(await ipc.invoke('license:sync-songs', []), {
    ok: false,
    state: 'authorized',
    error: 'INVALID_SONG',
    index: 2,
  });
  licenseManager.getCloudSongs = async () => [{ title: 'Array song', token: 'drop' }];
  assert.deepEqual(await ipc.invoke('license:get-cloud-songs'), {
    songs: [{ title: 'Array song' }],
  });
  licenseManager.getCloudSongs = async () => ({
    items: [{ title: 'Items song', token: 'drop' }],
  });
  assert.deepEqual(await ipc.invoke('license:get-cloud-songs'), {
    songs: [{ title: 'Items song' }],
  });

  for (const channel of ['license:get-state', 'license:get-profile']) {
    assert.deepEqual(
      await ipc.invoke(channel),
      {
        ok: true,
        state: 'authorized',
        error: 'LICENSE_ERROR',
        streamer: PUBLIC_STREAMER,
        device: PUBLIC_DEVICE,
      },
      channel,
    );
  }
  stateListener({
    state: 'authorized',
    error: 'accessToken=should-not-cross',
    streamer: { accountName: 'mlbb', accessToken: 'drop' },
  });
  assert.deepEqual(ipc.sent.at(-1), [
    'license:state-changed',
    { state: 'authorized', error: 'LICENSE_ERROR', streamer: PUBLIC_STREAMER },
  ]);
});

test('license IPC rejects backslash-based external relative URLs', async () => {
  const ipc = createLicenseIpcFixture({
    framePath: '/admin',
    licenseManager: {
      getSongPageBackground: async () => ({
        ok: true,
        background: { url: '/\\\\attacker.example/background.png' },
      }),
    },
  });

  assert.deepEqual(await ipc.invoke('license:get-song-page-background'), { ok: true, background: null });
});

test('license IPC does not forward arbitrary exception messages as error codes', async () => {
  const ipc = createLicenseIpcFixture({
    framePath: '/',
    licenseManager: {
      getCloudSongs: async () => {
        throw new Error('accessToken=secret-value');
      },
    },
  });

  assert.deepEqual(await ipc.invoke('license:get-cloud-songs'), {
    ok: false,
    state: 'authorized',
    error: 'LICENSE_ERROR',
  });
});

test('gift catalog initialization IPC is authorized, sanitized, and retryable', async () => {
  let licenseState = 'authorized';
  let initializationListener = null;
  let initializationCalls = 0;
  const giftCatalog = {
    getState: () => ({
      status: 'running',
      phase: 'images',
      completed: 3,
      total: 10,
      available: 2,
      failed: 1,
      percent: 35,
      currentGiftId: '123',
      currentGiftName: '测试礼物',
      sourceUrl: 'https://should-not-cross.example/image.webp',
    }),
    initialize: async () => {
      initializationCalls += 1;
      return {
        status: 'ready',
        background: true,
        phase: 'complete',
        completed: 10,
        total: 10,
        available: 9,
        failed: 1,
        percent: 100,
        completedAt: '2026-09-05T00:00:00.000Z',
        accessToken: 'should-not-cross',
      };
    },
    onStateChanged: (listener) => {
      initializationListener = listener;
      return () => {};
    },
  };
  const ipc = createLicenseIpcFixture({
    framePath: '/license',
    giftCatalog,
    licenseManager: {
      getState: () => licenseState,
      getSnapshot: () => ({ state: licenseState }),
    },
  });

  assert.deepEqual(await ipc.invoke('license:get-gift-catalog-state'), {
    ok: true,
    status: 'running',
    background: false,
    phase: 'images',
    completed: 3,
    total: 10,
    available: 2,
    failed: 1,
    percent: 35,
    currentGiftId: '123',
    currentGiftName: '测试礼物',
    completedAt: null,
    error: null,
    warning: null,
  });

  const retried = await ipc.invoke('license:retry-gift-catalog', {
    sourceUrl: 'https://attacker.example/image.webp',
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.status, 'ready');
  assert.equal(retried.background, true);
  assert.equal(retried.completedAt, '2026-09-05T00:00:00.000Z');
  assert.equal(retried.accessToken, undefined);
  assert.equal(initializationCalls, 1);

  initializationListener({
    status: 'running',
    background: 'true',
    phase: 'images',
    total: 2,
    completed: 99,
    available: 99,
    failed: 99,
    percent: 999,
    currentGiftName: 'x'.repeat(200),
    completedAt: 'not-a-timestamp',
    token: 'drop',
  });
  assert.deepEqual(ipc.sent[0], [
    'license:gift-catalog-state-changed',
    {
      status: 'running',
      background: false,
      phase: 'images',
      completed: 2,
      total: 2,
      available: 2,
      failed: 2,
      percent: 100,
      currentGiftId: '',
      currentGiftName: 'x'.repeat(100),
      completedAt: null,
      error: null,
      warning: null,
    },
  ]);

  licenseState = 'needs_activation';
  const rejected = await ipc.invoke('license:retry-gift-catalog');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'LICENSE_REQUIRED');
  assert.equal(initializationCalls, 1);
});
