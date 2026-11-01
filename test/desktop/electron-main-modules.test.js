'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createShutdownHarness } = require('../helpers/electron-shutdown');

test('desktop local font permission requires the exact app origin and explicit approval', async () => {
  const { registerLocalFontPermissionHandler } = require('../../src/electron/desktop-permissions');
  let permissionHandler = null;
  let response = 0;
  const prompts = [];
  registerLocalFontPermissionHandler({
    desktopSession: {
      setPermissionRequestHandler(handler) {
        permissionHandler = handler;
      },
    },
    dialog: {
      async showMessageBox(parent, options) {
        prompts.push({ parent, options });
        return { response };
      },
    },
    desktopBaseUrl: 'http://127.0.0.1:3000',
    getMainWindow: () => ({}),
    hasExactOrigin(candidate, baseUrl) {
      return new URL(candidate).origin === new URL(baseUrl).origin;
    },
  });

  const request = (permission, requestingUrl) =>
    new Promise((resolve) => {
      permissionHandler({ getURL: () => requestingUrl }, permission, resolve, {
        requestingUrl,
      });
    });

  assert.equal(await request('localFonts', 'http://127.0.0.1:3000/admin?desktop=1'), true);
  assert.equal(prompts.length, 1);

  response = 1;
  assert.equal(await request('localFonts', 'http://127.0.0.1:3000/admin?desktop=1'), false);
  assert.equal(await request('localFonts', 'https://example.com/'), false);
  assert.equal(await request('notifications', 'http://127.0.0.1:3000/admin?desktop=1'), false);
  assert.equal(prompts.length, 2);
});

test('desktop injects Electron safeStorage into the backend runtime', async () => {
  const h = createShutdownHarness();
  await h.start();
  assert.equal(h.runtimeOptions.safeStorage, h.safeStorage);
});
