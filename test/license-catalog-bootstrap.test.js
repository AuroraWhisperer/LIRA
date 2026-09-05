'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');

test('gift catalog initialization IPC is authorized, sanitized, and retryable', async () => {
  const handlers = new Map();
  const sent = [];
  const webContents = { send: (...args) => sent.push(args) };
  const mainWindow = { webContents, isDestroyed: () => false };
  const desktopBaseUrl = 'http://127.0.0.1:3210';
  const trustedEvent = {
    sender: webContents,
    senderFrame: { url: `${desktopBaseUrl}/license` },
  };
  let licenseState = 'authorized';
  let initializationListener = null;
  let initializationCalls = 0;
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => licenseState,
    getSnapshot: () => ({ state: licenseState }),
    onStateChanged: () => () => {},
  };
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

  registerLicenseIpc({
    ipcMain: {
      removeHandler() {},
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    licenseManager,
    giftCatalog,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => desktopBaseUrl,
    hasExactOrigin: (candidate, expected) =>
      new URL(candidate).origin === new URL(expected).origin,
  });

  assert.deepEqual(
    await handlers.get('license:get-gift-catalog-state')(trustedEvent),
    {
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
    },
  );

  const retried = await handlers.get('license:retry-gift-catalog')(
    trustedEvent,
    { sourceUrl: 'https://attacker.example/image.webp' },
  );
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
  assert.deepEqual(sent[0], [
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
  const rejected = await handlers.get('license:retry-gift-catalog')(
    trustedEvent,
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'LICENSE_REQUIRED');
  assert.equal(initializationCalls, 1);
});
