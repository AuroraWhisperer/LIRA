'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createShutdownHarness } = require('../helpers/electron-shutdown');

test('desktop runtime adapts the legacy server API without changing calls', async () => {
  const { createDesktopRuntime } = require('../../src/electron/desktop-runtime');
  const calls = [];
  const importedEvents = [];
  const giftSyncCalls = [];
  const legacy = {
    startServer(options) {
      calls.push(['start', options]);
      return { baseUrl: 'http://127.0.0.1:3000' };
    },
    shutdownApplication(options) {
      calls.push(['stop', options]);
    },
    setPreShutdownHook(hook) {
      calls.push(['hook', hook]);
    },
    persistPlaybackSnapshot(payload, clientId) {
      return { payload, clientId };
    },
    getSetting(key) {
      return `setting:${key}`;
    },
    getApiToken: () => 'synthetic-main-token',
    resolveGiftSource(sourceKey) {
      giftSyncCalls.push(['resolve', sourceKey]);
      return { id: 7, sourceKey };
    },
    getGiftSyncState(sourceId) {
      giftSyncCalls.push(['state', sourceId]);
      return { sourceId, projectionGeneration: 3 };
    },
    commitGiftHistoryPage(page) {
      giftSyncCalls.push(['history', page]);
      return page;
    },
    restartGiftHistoryBootstrap(sourceId, projectionGeneration) {
      giftSyncCalls.push(['restart', sourceId, projectionGeneration]);
      return { sourceId, projectionGeneration };
    },
    commitGiftCatchUpPage(page) {
      giftSyncCalls.push(['catch-up', page]);
      return page;
    },
    commitLegacyGiftPage(page) {
      giftSyncCalls.push(['legacy', page]);
      return page;
    },
    resetGiftProjectionForRebuild(sourceId) {
      giftSyncCalls.push(['reset', sourceId]);
      return { sourceId, projectionGeneration: 4 };
    },
    setActiveGiftSource(source) {
      giftSyncCalls.push(['active', source]);
      return source;
    },
    importProcessedGiftEvent(event, sourceId) {
      importedEvents.push({ event, sourceId });
      return { imported: event.eventId };
    },
  };
  const runtime = createDesktopRuntime(legacy);
  const hook = () => {};

  assert.deepEqual(await runtime.start({ host: '127.0.0.1' }), {
    baseUrl: 'http://127.0.0.1:3000',
  });
  await runtime.stop({ exitProcess: false });
  runtime.setPreShutdownHook(hook);
  assert.deepEqual(runtime.persistPlaybackSnapshot({ currentMs: 10 }, 'desktop'), {
    payload: { currentMs: 10 },
    clientId: 'desktop',
  });
  assert.equal(runtime.getSetting('theme'), 'setting:theme');
  assert.equal(runtime.getApiToken(), 'synthetic-main-token');
  const processedEvent = {
    eventId: 'gift-1',
    phase: 'final',
    cursor: 1,
    gift: { giftName: '小花花', totalPrice: 1 },
  };
  assert.deepEqual(await runtime.importProcessedGiftEvent(processedEvent, 7), {
    imported: 'gift-1',
  });
  const sourceKey = 'a'.repeat(64);
  assert.deepEqual(runtime.resolveGiftSource(sourceKey), {
    id: 7,
    sourceKey,
  });
  assert.deepEqual(runtime.getGiftSyncState(7), {
    sourceId: 7,
    projectionGeneration: 3,
  });
  runtime.commitGiftHistoryPage({ page: 'history' });
  runtime.restartGiftHistoryBootstrap(7, 3);
  runtime.commitGiftCatchUpPage({ page: 'catch-up' });
  runtime.commitLegacyGiftPage({ page: 'legacy' });
  runtime.resetGiftProjectionForRebuild(7);
  runtime.setActiveGiftSource({ sourceId: 7 });
  assert.deepEqual(importedEvents, [{ event: processedEvent, sourceId: 7 }]);
  assert.deepEqual(giftSyncCalls, [
    ['resolve', sourceKey],
    ['state', 7],
    ['history', { page: 'history' }],
    ['restart', 7, 3],
    ['catch-up', { page: 'catch-up' }],
    ['legacy', { page: 'legacy' }],
    ['reset', 7],
    ['active', { sourceId: 7 }],
  ]);
  assert.deepEqual(calls, [
    ['start', { host: '127.0.0.1' }],
    ['stop', { exitProcess: false }],
    ['hook', hook],
  ]);
});

test('desktop local font permission requires the exact app origin and explicit approval', async () => {
  const { registerLocalFontPermissionHandler } = require('../../src/electron/desktop-permissions');
  let permissionHandler = null;
  let response = 0;
  const prompts = [];
  const mainWindow = { id: 'main-window' };
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
    getMainWindow: () => mainWindow,
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
  assert.equal(prompts[0].parent, mainWindow);
  assert.match(prompts[0].options.message, /读取本机字体列表/);
  assert.match(prompts[0].options.detail, /点歌板风格 3–6/);
  assert.match(prompts[0].options.detail, /桌面歌词/);
  assert.match(prompts[0].options.detail, /不会读取字体文件/);

  response = 1;
  assert.equal(await request('localFonts', 'http://127.0.0.1:3000/admin?desktop=1'), false);
  assert.equal(await request('localFonts', 'https://example.com/'), false);
  assert.equal(await request('notifications', 'http://127.0.0.1:3000/admin?desktop=1'), false);
  assert.equal(prompts.length, 2);
});

test('desktop injects Electron safeStorage and delegates gift rebuilds to the remote controller', async () => {
  const h = createShutdownHarness();
  await h.start();
  assert.equal(h.runtimeOptions.safeStorage, h.safeStorage);
  assert.equal(h.count('remote:create'), 1);
  assert.equal(h.runtimeStartOptions.giftSync.rebuild(), true);
  assert.equal(h.count('remote:start'), 1);
});
