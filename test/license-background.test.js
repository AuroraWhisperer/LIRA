'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createRemoteLicenseClient,
} = require('../src/electron/license/remote-license-client');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');

const ROOT = path.join(__dirname, '..');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test('remote license client sends song background bytes without JSON encoding', async () => {
  const calls = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    isProduction: true,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true, background: null });
    },
  });
  const bytes = new Uint8Array([137, 80, 78, 71]);

  await client.uploadSongPageBackground(bytes, 'image/png', 'device-token');

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.example.test/api/device/song-page/background',
  );
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.body, bytes);
  assert.equal(calls[0].init.headers['Content-Type'], 'image/png');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer device-token');
});

test('license IPC validates song background payloads at the process boundary', async () => {
  const handlers = new Map();
  const uploadCalls = [];
  const webContents = {};
  const mainWindow = { webContents, isDestroyed: () => false };
  const desktopBaseUrl = 'http://127.0.0.1:3210';
  const trustedEvent = {
    sender: webContents,
    senderFrame: { url: `${desktopBaseUrl}/admin?desktop=1` },
  };
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => 'authorized',
    getSnapshot: () => ({}),
    getSongPageBackground: async () => ({ ok: true, background: null }),
    uploadSongPageBackground: async (...args) => {
      uploadCalls.push(args);
      return { background: { url: '/background.png' } };
    },
    deleteSongPageBackground: async () => ({ ok: true, background: null }),
    onStateChanged: () => () => {},
  };
  const ipcMain = {
    removeHandler: () => {},
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  registerLicenseIpc({
    ipcMain,
    licenseManager,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => desktopBaseUrl,
    hasExactOrigin: (candidate, expected) =>
      new URL(candidate).origin === new URL(expected).origin,
  });

  const handler = handlers.get('license:upload-song-page-background');
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(
    await handler(trustedEvent, { bytes, fileName: 'cover.png' }),
    {
      ok: true,
      background: { url: '/background.png' },
    },
  );
  assert.equal(uploadCalls[0][0], bytes);
  assert.equal(uploadCalls[0][1], 'cover.png');

  assert.deepEqual(
    await handler(trustedEvent, { bytes: [1, 2, 3], fileName: 'cover.png' }),
    {
      ok: false,
      state: 'authorized',
      error: 'BACKGROUND_IMAGE_REQUIRED',
    },
  );
  assert.deepEqual(
    await handler(trustedEvent, {
      bytes: new Uint8Array(5 * 1024 * 1024 + 1),
      fileName: 'cover.png',
    }),
    {
      ok: false,
      state: 'authorized',
      error: 'PAYLOAD_TOO_LARGE',
    },
  );

  assert.deepEqual(
    await handler(
      {
        sender: webContents,
        senderFrame: { url: 'https://attacker.example/admin' },
      },
      { bytes, fileName: 'cover.png' },
    ),
    {
      ok: false,
      state: 'authorized',
      error: 'IPC_SOURCE_INVALID',
    },
  );
  assert.equal(uploadCalls.length, 1);
});

test('license IPC allowlists remote responses before crossing into the renderer', async () => {
  const handlers = new Map();
  let stateChanged = null;
  const webContents = {
    send: (...args) => {
      stateChanged = args;
    },
  };
  const mainWindow = { webContents, isDestroyed: () => false };
  const desktopBaseUrl = 'http://127.0.0.1:3210';
  const trustedEvent = {
    sender: webContents,
    senderFrame: { url: `${desktopBaseUrl}/admin?desktop=1` },
  };
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => 'authorized',
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
        previewUrl:
          'https://api.example.test/background.png?private_key_pem=drop',
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
      stateChanged = listener;
      return () => {};
    },
  };
  const ipcMain = {
    removeHandler: () => {},
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  registerLicenseIpc({
    ipcMain,
    licenseManager,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => desktopBaseUrl,
    hasExactOrigin: (candidate, expected) =>
      new URL(candidate).origin === new URL(expected).origin,
  });

  assert.equal(handlers.has('license:create-pairing-code'), false);
  assert.equal(handlers.has('license:list-pairing-codes'), false);
  assert.equal(handlers.has('license:revoke-pairing-code'), false);

  assert.deepEqual(await handlers.get('license:sync-songs')(trustedEvent, []), {
    ok: true,
    count: 2,
  });
  assert.deepEqual(
    await handlers.get('license:activate')(trustedEvent, {
      accountName: 'mlbb',
      password: 'password',
      activationCode: 'ACTIVATE',
    }),
    {
      ok: true,
      state: 'authorized',
      streamer: { accountName: 'mlbb', displayName: 'mlbb', subdomain: '' },
    },
  );
  assert.deepEqual(await handlers.get('license:retry')(trustedEvent), {
    ok: true,
    state: 'authorized',
    error: 'LICENSE_ERROR',
    streamer: { accountName: 'mlbb', displayName: 'mlbb', subdomain: '' },
    device: { id: 'd', name: '', status: '', licenseId: '' },
  });
  assert.deepEqual(
    await handlers.get('license:get-cloud-songs')(trustedEvent),
    {
      songs: [{ title: 'Song', artist: 'Artist' }],
    },
  );
  assert.deepEqual(
    await handlers.get('license:get-song-page-background')(trustedEvent),
    {
      ok: true,
      background: { bytes: 12, updatedAt: '2026-08-29T00:00:00.000Z' },
    },
  );
  assert.deepEqual(
    await handlers.get('license:upload-song-page-background')(trustedEvent, {
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
  assert.deepEqual(
    await handlers.get('license:delete-song-page-background')(trustedEvent),
    {
      ok: true,
      background: null,
    },
  );

  licenseManager.syncSongs = async () => ({ ok: false, count: 0 });
  assert.deepEqual(await handlers.get('license:sync-songs')(trustedEvent, []), {
    ok: false,
    count: 0,
  });
  licenseManager.getCloudSongs = async () => [
    { title: 'Array song', token: 'drop' },
  ];
  assert.deepEqual(
    await handlers.get('license:get-cloud-songs')(trustedEvent),
    {
      songs: [{ title: 'Array song' }],
    },
  );
  licenseManager.getCloudSongs = async () => ({
    items: [{ title: 'Items song', token: 'drop' }],
  });
  assert.deepEqual(
    await handlers.get('license:get-cloud-songs')(trustedEvent),
    {
      songs: [{ title: 'Items song' }],
    },
  );

  const snapshot = await handlers.get('license:get-state')(trustedEvent);
  assert.deepEqual(snapshot, {
    ok: true,
    state: 'authorized',
    error: 'LICENSE_ERROR',
    streamer: { accountName: 'mlbb', displayName: 'mlbb', subdomain: '' },
    device: { id: 'd', name: '', status: '', licenseId: '' },
  });
  const profile = await handlers.get('license:get-profile')(trustedEvent);
  assert.deepEqual(profile, {
    ok: true,
    state: 'authorized',
    error: 'LICENSE_ERROR',
    streamer: { accountName: 'mlbb', displayName: 'mlbb', subdomain: '' },
    device: { id: 'd', name: '', status: '', licenseId: '' },
  });
  stateChanged({
    state: 'authorized',
    error: 'accessToken=should-not-cross',
    streamer: { accountName: 'mlbb', accessToken: 'drop' },
  });
  assert.deepEqual(stateChanged && stateChanged[0], 'license:state-changed');
  assert.deepEqual(stateChanged && stateChanged[1], {
    state: 'authorized',
    error: 'LICENSE_ERROR',
    streamer: { accountName: 'mlbb', displayName: 'mlbb', subdomain: '' },
  });
});

test('license IPC rejects backslash-based external relative URLs', async () => {
  const handlers = new Map();
  const webContents = {};
  const mainWindow = { webContents, isDestroyed: () => false };
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => 'authorized',
    getSongPageBackground: async () => ({
      ok: true,
      background: { url: '/\\\\attacker.example/background.png' },
    }),
    onStateChanged: () => () => {},
  };
  const ipcMain = {
    removeHandler: () => {},
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  registerLicenseIpc({
    ipcMain,
    licenseManager,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => 'http://127.0.0.1:3210',
    hasExactOrigin: () => true,
  });

  const result = await handlers.get('license:get-song-page-background')({
    sender: webContents,
    senderFrame: { url: 'http://127.0.0.1:3210/admin' },
  });
  assert.deepEqual(result, { ok: true, background: null });
});

test('license IPC does not forward arbitrary exception messages as error codes', async () => {
  const handlers = new Map();
  const webContents = {};
  const mainWindow = { webContents, isDestroyed: () => false };
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => 'authorized',
    getCloudSongs: async () => {
      throw new Error('accessToken=secret-value');
    },
    onStateChanged: () => () => {},
  };
  const ipcMain = {
    removeHandler: () => {},
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  registerLicenseIpc({
    ipcMain,
    licenseManager,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => 'http://127.0.0.1:3210',
    hasExactOrigin: () => true,
  });

  const result = await handlers.get('license:get-cloud-songs')({
    sender: webContents,
    senderFrame: { url: 'http://127.0.0.1:3210/' },
  });
  assert.deepEqual(result, {
    ok: false,
    state: 'authorized',
    error: 'LICENSE_ERROR',
  });
});

test('song background panel is wired into the admin import page and preload bridge', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'public', 'pages', 'admin', 'song', 'import-export.html'),
    'utf8',
  );
  const importScript = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'admin', 'import.js'),
    'utf8',
  );
  const preload = fs.readFileSync(
    path.join(ROOT, 'src', 'electron', 'preload.js'),
    'utf8',
  );

  assert.match(html, /id="licenseSongBackground"/);
  assert.match(html, /id="licenseSongBgPreview"/);
  assert.match(html, /id="licenseSongBgFile"/);
  assert.match(importScript, /uploadSongPageBackground/);
  assert.match(importScript, /deleteSongPageBackground/);
  assert.match(importScript, /previewUrl/);
  assert.doesNotMatch(importScript, /api\.lirahub\.cn/);
  assert.match(preload, /getSongPageBackground/);
  assert.match(preload, /license:upload-song-page-background/);
  assert.match(preload, /license:delete-song-page-background/);
});
