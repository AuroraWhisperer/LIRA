'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRemoteLicenseClient } = require('../../src/electron/license/remote-license-client');
const { createLicenseIpcFixture } = require('../helpers/license-ipc-fixture');

const ROOT = path.join(__dirname, '../..');

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
  assert.equal(calls[0].url, 'https://api.example.test/api/device/song-page/background');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.body, bytes);
  assert.equal(calls[0].init.headers['Content-Type'], 'image/png');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer device-token');
});

test('license IPC validates song background payloads at the process boundary', async () => {
  const uploadCalls = [];
  const { handlers, trustedEvent, eventFrom } = createLicenseIpcFixture({
    licenseManager: {
      getSongPageBackground: async () => ({ ok: true, background: null }),
      uploadSongPageBackground: async (...args) => {
        uploadCalls.push(args);
        return { background: { url: '/background.png' } };
      },
      deleteSongPageBackground: async () => ({ ok: true, background: null }),
    },
  });

  const handler = handlers.get('license:upload-song-page-background');
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(await handler(trustedEvent, { bytes, fileName: 'cover.png' }), {
    ok: true,
    background: { url: '/background.png' },
  });
  assert.equal(uploadCalls[0][0], bytes);
  assert.equal(uploadCalls[0][1], 'cover.png');

  assert.deepEqual(await handler(trustedEvent, { bytes: [1, 2, 3], fileName: 'cover.png' }), {
    ok: false,
    state: 'authorized',
    error: 'BACKGROUND_IMAGE_REQUIRED',
  });
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
    await handler(eventFrom('https://attacker.example/admin'), { bytes, fileName: 'cover.png' }),
    {
      ok: false,
      state: 'authorized',
      error: 'IPC_SOURCE_INVALID',
    },
  );
  assert.equal(uploadCalls.length, 1);
});

// Response allowlists, URL and error sanitizing, and gift catalog IPC: test/license/license-ipc.test.js.

test('song background panel is wired into the admin import page and preload bridge', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'admin', 'song', 'import-export.html'), 'utf8');
  const importScript = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'song-background.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'electron', 'preload.js'), 'utf8');

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
