'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
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

test('song background panel and preload preserve the background IPC contract', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'admin', 'song', 'import-export.html'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'electron', 'preload.js'), 'utf8');

  assert.match(html, /id="licenseSongBackground"/);
  assert.match(html, /id="licenseSongBgPreview"/);
  assert.match(html, /id="licenseSongBgFile"/);
  const bridges = new Map();
  const calls = [];
  const response = { ok: true, background: null };
  vm.runInNewContext(preload, {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, bridge) => bridges.set(name, bridge) },
        ipcRenderer: {
          async invoke(...args) {
            calls.push(args);
            return response;
          },
        },
      };
    },
  });
  const bridge = bridges.get('liraLicense');
  const bytes = new Uint8Array([137, 80, 78, 71]);
  assert.deepEqual(await bridge.getSongPageBackground(), response);
  assert.deepEqual(await bridge.uploadSongPageBackground(bytes, 'cover.png'), response);
  assert.deepEqual(await bridge.deleteSongPageBackground(), response);
  assert.deepEqual(calls.map(([channel]) => channel), [
    'license:get-song-page-background',
    'license:upload-song-page-background',
    'license:delete-song-page-background',
  ]);
  assert.equal(Object.prototype.toString.call(calls[1][1].bytes), '[object Uint8Array]');
  assert.deepEqual(Array.from(calls[1][1].bytes), Array.from(bytes));
  assert.equal(calls[1][1].fileName, 'cover.png');
  // Renderer preview safety and initialization ordering: license-ui.test.js.
  // The legacy import entry is exercised by cloud-song-sync-ui.test.js.
});
