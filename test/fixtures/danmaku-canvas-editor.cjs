'use strict';

// Isolated Electron host: real admin HTML, preload, request auth and overlay IPC.
if (process.versions.electron) run().catch((error) => {
  console.error(error);
  require('electron').app.exit(1);
});

async function run() {
  const path = require('node:path');
  const fs = require('node:fs');
  const { app, BrowserWindow, session, ipcMain } = require('electron');
  const { createHttpServer } = require('../../src/server/http-server');
  const { servePageOrAsset } = require('../../src/server/http-utils');
  const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
  const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');
  const { registerLicenseIpc } = require('../../src/electron/ipc/license-ipc');
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory)) throw new Error('An isolated absolute test directory is required.');
  fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  await app.whenReady();
  const token = 'synthetic-canvas-parent-secret';
  const root = path.resolve(__dirname, '../..');
  let saved = { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {}, layout: null,
    overlayUrl: 'https://canvas.example.test/overlay/syntheticKey_123' };
  global.canvasTest = { writes: [], failNext: false, saved: () => saved };
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0, dataDir: directory, getPhase: () => 'ready',
    getStartedPort: () => server.address().port, isLicenseAuthorized: () => true,
    inflightTracker: { run: (fn) => fn() }, getSettings: () => ({}),
    createApiContext: () => ({ sessionToken: token, settings: { get: () => ({}) }, system: { dataDir: directory } }),
    servePageOrAsset(req, res, url) {
      if (url.pathname === '/js/admin/index.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`import { initDanmakuOverlaySettings } from './danmaku-overlay-settings.js';
          const panel = document.getElementById('otherDanmakuFeature');
          document.body.replaceChildren(panel); panel.hidden = false; panel.style.display = "block";
          document.body.style.cssText = 'display:block;overflow:auto;padding:24px';
          const ids = { overlayUrl:'danmakuOverlayUrl', styleChip:'danmakuStyleChip', styleSaveState:'danmakuStyleSaveState',
            fullscreenDurationField:'danmakuFullscreenDurationField', fullscreenDuration:'danmakuFullscreenDurationSeconds',
            copyOverlayUrlButton:'danmakuCopyOverlayUrlBtn', openOverlayButton:'danmakuOpenOverlayBtn', previewOverlayButton:'danmakuPreviewOverlayBtn' };
          const elements = Object.fromEntries(Object.entries(ids).map(([key,id]) => [key,document.getElementById(id)]));
          elements.styleButtons = Array.from(document.querySelectorAll('[data-danmaku-style]'));
          initDanmakuOverlaySettings(elements, () => {});`);
        return;
      }
      if (url.pathname === '/js/playback.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(''); return; }
      servePageOrAsset(path.join(root, 'public'), req, res, url, token);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${origin}/danmaku?preview=1`)).status !== 200) throw new Error('Preview route unavailable.');
  if ((await fetch(`${origin}/admin`)).status !== 401) throw new Error('Admin route must require desktop auth.');
  const window = new BrowserWindow({ width: 1440, height: 960, show: false,
    webPreferences: { preload: path.join(root, 'src/electron/preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  const auth = createDesktopRequestAuth({ desktopSession: session.defaultSession, getMainWindow: () => window,
    getBaseUrl: () => origin, getToken: () => token });
  configureMediaRequestHeaders(session.defaultSession, {}, auth);
  auth.bindWindow(window, { openExternal() { throw new Error('Test must not open external applications.'); } });
  registerLicenseIpc({ ipcMain, getMainWindow: () => window, getDesktopBaseUrl: () => origin,
    hasExactOrigin: (url, expected) => new URL(url).origin === expected,
    licenseManager: {
      getState: () => 'authorized', onStateChanged: () => () => {},
      getProfile: async () => ({ state: 'authorized', streamer: { accountName: 'canvas-test', songPageUrl: 'https://canvas.example.test/' } }),
      getOverlaySettings: async () => saved,
      updateOverlaySettings: async (value) => {
        if (global.canvasTest.failNext) { global.canvasTest.failNext = false; throw new Error('NETWORK_UNAVAILABLE'); }
        saved = { ...saved, ...value };
        global.canvasTest.writes.push(value);
        return saved;
      },
    },
  });
  app.once('before-quit', () => { auth.dispose(); server.closeAllConnections(); server.close(); });
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(`${origin}/admin`);
}
