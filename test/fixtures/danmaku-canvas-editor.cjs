'use strict';

// Isolated Electron host: real admin HTML, preload, request auth and overlay IPC.
if (process.versions.electron) run().catch((error) => {
  console.error(error);
  require('electron').app.exit(1);
});

async function run() {
  const path = require('node:path');
  const fs = require('node:fs');
  const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
  const { createComponentWebPicker } = require('../../src/electron/component-web-picker');
  const { createHttpServer } = require('../../src/server/http-server');
  const { createWebSocketHub } = require('../../src/server/ws');
  const { servePageOrAsset } = require('../../src/server/page-assets');
  const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
  const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');
  const { registerLicenseIpc } = require('../../src/electron/ipc/license-ipc');
  const { DatabaseSync } = require('node:sqlite');
  const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
  const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets, migrateSceneDeletion } = require('../../src/storage/scene-migration');
  const { createSceneStore } = require('../../src/storage/scene-store');
  const { createSceneService } = require('../../src/scenes/scene-service');
  const { readSceneSharedAppearances } = require('../../src/server/scene-shared-appearance');
  const { createSceneComponentPorts } = require('../../src/server/scene-components');
  const { getComponentPreviewOwner } = require('../../src/electron/scene-cloud-controller');
  const { HEARTBEAT_INTERVAL_MS } = require('../../src/electron/license/license-runtime-policy');
  const { createHarness } = require('../helpers/license-manager-harness');
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory)) throw new Error('An isolated absolute test directory is required.');
  fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  await app.whenReady();
  const licenseTasks = new Set();
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', licenseId: 'l', streamerId: 1, publicKeyPem: 'public' },
    timers: {
      setTimeout(callback, delay) { const task = { callback, delay }; licenseTasks.add(task); return task; },
      clearTimeout(task) { licenseTasks.delete(task); },
    },
  });
  const streamer = { accountName: 'canvas-test', songPageUrl: 'https://canvas.example.test/' };
  const verify = remote.verify;
  remote.verify = async (...args) => ({ ...await verify(...args), streamer });
  await manager.bootstrap();
  const token = 'synthetic-canvas-parent-secret';
  const root = path.resolve(__dirname, '../..');
  const openingSettings = {};
  const getState = () => ({ settings: { ...DEFAULT_SETTINGS, ...openingSettings } });
  const hub = createWebSocketHub({ closeTimeoutMs: 20 });
  let saved = { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {}, layout: null,
    overlayUrl: 'https://canvas.example.test/overlay/syntheticKey_123' };
  const db = new DatabaseSync(':memory:');
  migrateScenes(db);
  migrateComponentOutputSizes(db);
  migrateCanvasPresets(db);
  migrateSceneDeletion(db);
  const scenes = createSceneService({ store: createSceneStore(db), getOwner: () => ({ scope: 'canvas-test', epoch: 1 }),
    getSharedAppearances: items => readSceneSharedAppearances({ settings: { get: () => openingSettings },
      system: { dataDir: directory, getState }, readDanmakuDisplay: () => ({ config: saved }) }, items),
    secretCodec: { isAvailable: () => true, encrypt: value => Buffer.from(value).toString('base64'),
      decrypt: value => Buffer.from(value, 'base64').toString() },
    ...createSceneComponentPorts({ getState: () => ({ settings: openingSettings }), cloud: { getSettings: () => {
      const { style, fullscreenDurationSeconds, styleOptions, layout, styleParameters } = saved;
      return { style, fullscreenDurationSeconds, styleOptions, layout, ...(styleParameters ? { styleParameters } : {}) };
    } } }) });
  global.canvasTest = { writes: [], attempts: 0, requests: [], externalUrls: [], failNext: false,
    openingSettings,
    saved: () => saved, scene: () => scenes.list()[0], componentSize: () => scenes.getComponentSize('danmaku'),
    authorization: () => ({ epoch: manager.getAuthorizationEpoch(), generation: manager.getAuthorizationGeneration() }),
    async renewAuthorization() {
      const task = [...licenseTasks].find(({ delay }) => delay !== HEARTBEAT_INTERVAL_MS);
      if (!task) throw new Error('Expected a scheduled authorization renewal.');
      licenseTasks.delete(task);
      task.callback();
      await manager.ensureAuthorized();
    },
  };
  const pickComponentWebFile = createComponentWebPicker({ dialog, getWindow: () => window });
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0, dataDir: directory, getPhase: () => 'ready',
    getStartedPort: () => server.address().port, isLicenseAuthorized: () => manager.isAuthorized(),
    getPreviewOwner: () => getComponentPreviewOwner(manager),
    inflightTracker: { run: (fn) => fn() }, getSettings: () => openingSettings,
    getWebSocketHub: () => hub,
    getWebSocketContext: base => ({ sessionToken: token, allowedOrigins: [base], getState }),
    createApiContext: () => ({ sessionToken: token, scenes, settings: { get: () => openingSettings, defaults: DEFAULT_SETTINGS,
      set(key, value) { openingSettings[key] = value; },
      setMany(patch) { Object.assign(openingSettings, patch); return Object.keys(patch); } },
      bilibili: { configure() {} }, broadcastSnapshot(reason) { hub.broadcastSnapshot({ getState }, reason); },
      system: { dataDir: directory, pickComponentWebFile, getState } }),
    servePageOrAsset(req, res, url) {
      if (url.pathname === '/js/admin/index.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`import { initDanmakuOverlaySettings } from './danmaku-overlay-settings.js';
          import { setComponentPreviewPreparation, getComponentPreviews } from './component-preview-registry.js';
          import { prepareComponentPreviewCanvas } from './component-preview-canvas-controller.js';
          import { waitForServerOverlayUrlInitialization } from './server-overlay-url.js';
          import { initCanvasOverlaySource } from './canvas-overlay-source.js';
          const panel = document.getElementById('liveDanmakuFeature');
          const sources = document.getElementById('overlayPage');
          const sourceTab = document.querySelector('[data-tab="overlayPage"]');
          document.body.replaceChildren(panel, sourceTab, sources);
          panel.hidden = sources.hidden = false; panel.style.display = sources.style.display = "block";
          document.body.style.cssText = 'display:block;overflow:auto;padding:24px';
          const ids = { overlayUrl:'danmakuOverlayUrl', styleChip:'danmakuStyleChip', styleSaveState:'danmakuStyleSaveState',
            fullscreenDurationField:'danmakuFullscreenDurationField', fullscreenDuration:'danmakuFullscreenDurationSeconds',
            copyOverlayUrlButton:'danmakuCopyOverlayUrlBtn', openOverlayButton:'danmakuOpenOverlayBtn', previewOverlayButton:'danmakuPreviewOverlayBtn' };
          const elements = Object.fromEntries(Object.entries(ids).map(([key,id]) => [key,document.getElementById(id)]));
          elements.styleButtons = Array.from(document.querySelectorAll('[data-danmaku-style]'));
          initDanmakuOverlaySettings(elements, () => {});
          setComponentPreviewPreparation(async () => {
            await waitForServerOverlayUrlInitialization();
            return prepareComponentPreviewCanvas(getComponentPreviews());
          });
          initCanvasOverlaySource();`);
        return;
      }
      if (url.pathname === '/js/playback.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(''); return; }
      servePageOrAsset(path.join(root, 'public'), req, res, url, token);
    },
  });
  server.prependListener('request', (req) => {
    global.canvasTest.requests.push({ url: req.url, authorization: req.headers.authorization || '' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${origin}/danmaku?preview=1&componentPreview=1`)).status !== 200) throw new Error('Preview route unavailable.');
  if ((await fetch(`${origin}/admin`)).status !== 401) throw new Error('Admin route must require desktop auth.');
  const window = new BrowserWindow({ width: 1440, height: 960, show: false,
    webPreferences: { preload: path.join(root, 'src/electron/preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  const auth = createDesktopRequestAuth({ desktopSession: session.defaultSession, getMainWindow: () => window,
    getBaseUrl: () => origin, getToken: () => token });
  configureMediaRequestHeaders(session.defaultSession, {}, auth);
  auth.bindWindow(window, { openExternal(url) { global.canvasTest.externalUrls.push(url); } });
  registerLicenseIpc({ ipcMain, getMainWindow: () => window, getDesktopBaseUrl: () => origin,
    hasExactOrigin: (url, expected) => new URL(url).origin === expected,
    licenseManager: {
      ...manager,
      getProfile: async () => ({ state: 'authorized', streamer }),
      getOverlaySettings: async () => saved,
      updateOverlaySettings: async (value) => {
        global.canvasTest.attempts += 1;
        if (global.canvasTest.failNext) { global.canvasTest.failNext = false; throw new Error('NETWORK_UNAVAILABLE'); }
        saved = { ...saved, ...value };
        global.canvasTest.writes.push(value);
        return saved;
      },
    },
  });
  app.once('before-quit', () => { manager.dispose(); auth.dispose(); hub.stop(); server.closeAllConnections(); server.close(); db.close(); });
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(`${origin}/admin`);
}
