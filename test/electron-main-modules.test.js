'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('desktop shutdown drains sync controllers before stopping the runtime', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'electron', 'main.js'),
    'utf8',
  );
  const start = source.indexOf("app.on('before-quit'");
  const end = source.indexOf('// ---- startup ----', start);
  const shutdown = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(
    shutdown,
    /const controllersToDrain = \[remoteGiftController, cloudSyncController\]/,
  );
  assert.match(
    shutdown,
    /Promise\.all\([\s\S]*?controller\.whenIdle\(\)[\s\S]*?\)[\s\S]*?\.then\([\s\S]*?lifecycleState[\s\S]*?\.shutdown\(\{ exitProcess: false \}\)/,
  );
  assert.ok(
    shutdown.indexOf('controller.whenIdle()') <
      shutdown.indexOf('lifecycleState.shutdown({ exitProcess: false })'),
  );
});

test('desktop runtime adapts the legacy server API without changing calls', async () => {
  const { createDesktopRuntime } = require('../src/electron/desktop-runtime');
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
  assert.deepEqual(
    runtime.persistPlaybackSnapshot({ currentMs: 10 }, 'desktop'),
    {
      payload: { currentMs: 10 },
      clientId: 'desktop',
    },
  );
  assert.equal(runtime.getSetting('theme'), 'setting:theme');
  const processedEvent = {
    eventId: 'gift-1',
    phase: 'final',
    cursor: 1,
    gift: { giftName: '小花花', totalPrice: 1 },
  };
  assert.deepEqual(
    await runtime.importProcessedGiftEvent(processedEvent, 7),
    { imported: 'gift-1' },
  );
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

test('desktop freezes gift source switching before waiting for cloud sync', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'electron', 'main.js'),
    'utf8',
  );
  const start = source.indexOf('licenseManager.onStateChanged');
  const end = source.indexOf("if (licenseManager.getState()", start);
  const stateChange = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source, /createRemoteGiftCursorStore/u);
  assert.match(source, /giftSync:\s*\{[\s\S]*?remoteGiftController\?\.start/u);
  assert.ok(
    stateChange.indexOf('remoteGiftController?.start()') <
      stateChange.indexOf('cloudSyncController'),
  );
  assert.match(stateChange, /remoteGiftController\?\.stop\(\)/u);
});

test('local media protocol enforces authorization and serves byte ranges', async (t) => {
  const {
    registerLocalMediaProtocol,
  } = require('../src/electron/local-media-protocol');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-local-media-'));
  const allowedPath = path.join(tempDir, 'allowed.mp3');
  const blockedPath = path.join(tempDir, 'blocked.mp3');
  fs.writeFileSync(allowedPath, Buffer.from('abcdef'));
  fs.writeFileSync(blockedPath, Buffer.from('blocked'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  let handler = null;
  registerLocalMediaProtocol(
    {
      handle(scheme, nextHandler) {
        assert.equal(scheme, 'local-media');
        handler = nextHandler;
      },
    },
    (filePath) => filePath === allowedPath,
  );

  const allowedUrl = `local-media://media/${Buffer.from(allowedPath).toString('base64url')}`;
  const partial = await handler({
    url: allowedUrl,
    headers: new Headers({ range: 'bytes=1-3' }),
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 1-3/6');
  assert.equal(
    Buffer.from(await partial.arrayBuffer()).toString('utf8'),
    'bcd',
  );

  const inverted = await handler({
    url: allowedUrl,
    headers: new Headers({ range: 'bytes=4-2' }),
  });
  assert.equal(inverted.status, 200);
  assert.equal(inverted.headers.get('content-range'), null);
  assert.equal(
    Buffer.from(await inverted.arrayBuffer()).toString('utf8'),
    'abcdef',
  );

  const blockedUrl = `local-media://media/${Buffer.from(blockedPath).toString('base64url')}`;
  const blocked = await handler({ url: blockedUrl, headers: new Headers() });
  assert.equal(blocked.status, 403);
});

test('desktop local font permission requires the exact app origin and explicit approval', async () => {
  const {
    registerLocalFontPermissionHandler,
  } = require('../src/electron/desktop-permissions');
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

  assert.equal(
    await request('localFonts', 'http://127.0.0.1:3000/admin?desktop=1'),
    true,
  );
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].parent, mainWindow);
  assert.match(prompts[0].options.message, /读取本机字体列表/);
  assert.match(prompts[0].options.detail, /点歌板风格 3–6/);
  assert.match(prompts[0].options.detail, /桌面歌词/);
  assert.match(prompts[0].options.detail, /不会读取字体文件/);

  response = 1;
  assert.equal(
    await request('localFonts', 'http://127.0.0.1:3000/admin?desktop=1'),
    false,
  );
  assert.equal(await request('localFonts', 'https://example.com/'), false);
  assert.equal(
    await request('notifications', 'http://127.0.0.1:3000/admin?desktop=1'),
    false,
  );
  assert.equal(prompts.length, 2);
});
