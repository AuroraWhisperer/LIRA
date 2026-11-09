'use strict';

// An isolated host for the production editor, preload and PNG export path.
if (process.versions.electron) run().catch(error => {
  console.error(error);
  require('electron').app.exit(1);
});

async function run() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { app, BrowserWindow, ipcMain, nativeImage, session } = require('electron');
  const { createHttpServer } = require('../../src/server/http-server');
  const { servePageOrAsset } = require('../../src/server/page-assets');
  const { createWeeklyScheduleExportController } = require('../../src/electron/weekly-schedule-export-controller');
  const { registerWeeklyScheduleIpc } = require('../../src/electron/ipc/weekly-schedule-ipc');

  app.disableHardwareAcceleration();
  const root = path.resolve(__dirname, '../..');
  const scratch = path.join(root, 'tmp');
  const directory = path.resolve(process.argv[2] || '');
  if (!directory.startsWith(scratch + path.sep)) throw new Error('Expected an isolated repository tmp directory.');
  for (const name of ['profile', 'sessions', 'logs', 'crashes', 'pictures']) fs.mkdirSync(path.join(directory, name), { recursive: true });
  app.setPath('userData', path.join(directory, 'profile'));
  app.setPath('sessionData', path.join(directory, 'sessions'));
  app.setPath('logs', path.join(directory, 'logs'));
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  app.setPath('pictures', path.join(directory, 'pictures'));
  await app.whenReady();

  const token = 'synthetic-weekly-schedule-desktop';
  const state = global.weeklyScheduleTest = {
    directory, origin: '', outputPath: path.join(directory, 'weekly-schedule.png'),
    cancelSaveDialog: false, exports: [], requests: [], assets: {}, ready: false,
  };
  const bitmap = Buffer.alloc(96 * 128 * 4);
  for (let y = 12; y < 116; y++) {
    for (let x = 12; x < 84; x++) {
      const offset = (y * 96 + x) * 4;
      bitmap[offset] = x * 2;
      bitmap[offset + 1] = y;
      bitmap[offset + 2] = 180;
      bitmap[offset + 3] = 255;
    }
  }
  state.assets.png = path.join(directory, 'synthetic-portrait.png');
  fs.writeFileSync(state.assets.png, nativeImage.createFromBitmap(bitmap, { width: 96, height: 128 }).toPNG());
  state.assets.webp = path.join(directory, 'synthetic-portrait.webp');
  fs.writeFileSync(state.assets.webp, Buffer.from('UklGRioAAABXRUJQVlA4TB0AAAAvH8AHEA8wZBMyqvMf8BDTEPqXdpsCEf2fAHq95QA=', 'base64'));

  const bootstrap = `
    import { other } from '/js/admin/toolbox-navigation.js';
    import { createToolboxLifecycle } from '/js/admin/toolbox-lifecycle.js';
    import { enhanceSelects } from '/js/shared/select-menu.js';
    const errors = window.weeklyScheduleFixtureErrors = [];
    const toolbox = createToolboxLifecycle({
      loaders: { otherWeeklyScheduleFeature: () => import('/js/admin/weekly-schedule.js').then(module => module.initWeeklySchedule) },
      onError: error => errors.push(error.message || String(error)),
    });
    document.documentElement.classList.remove('admin-starting');
    document.documentElement.classList.add('desktop-shell');
    document.body.classList.add('desktop-shell');
    document.querySelectorAll('.main-page').forEach(page => page.classList.toggle('active', page.id === 'otherAssistantPage'));
    enhanceSelects();
    toolbox.setPage('otherAssistantPage');
    other.initOtherPage({ onFeatureSelected: id => toolbox.selectFeature(id) });
    other.selectFeatureById('otherWeeklyScheduleFeature');
    window.addEventListener('beforeunload', () => toolbox.dispose(), { once: true });
  `;
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0, dataDir: directory,
    getPhase: () => 'ready', getStartedPort: () => server.address().port,
    isLicenseAuthorized: () => true, inflightTracker: { run: fn => fn() },
    getSettings: () => ({}), createApiContext: () => ({ sessionToken: token }),
    servePageOrAsset(req, res, url) {
      state.requests.push({ path: url.pathname, authorized: req.headers.authorization === `Bearer ${token}` });
      if (url.pathname === '/js/admin/index.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(bootstrap);
        return;
      }
      servePageOrAsset(path.join(root, 'public'), req, res, url, token);
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = state.origin = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${origin}/admin`)).status !== 401) throw new Error('Admin must require desktop authorization.');
  const window = new BrowserWindow({
    width: 1500, height: 1000, show: false,
    webPreferences: { preload: path.join(root, 'src/electron/preload.js'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false },
  });
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = new URL(details.url);
    if (details.resourceType === 'mainFrame' && details.webContentsId === window.webContents.id
      && url.origin === origin && url.pathname === '/admin') {
      details.requestHeaders.Authorization = `Bearer ${token}`;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  const controller = createWeeklyScheduleExportController({
    app, BrowserWindow, nativeImage, session,
    dialog: { async showSaveDialog() {
      return state.cancelSaveDialog ? { canceled: true } : { canceled: false, filePath: state.outputPath };
    } },
    getBaseUrl: () => origin, getSessionToken: () => token, getMainWindow: () => window,
  });
  const dispose = registerWeeklyScheduleIpc({
    ipcMain, getMainWindow: () => window, getDesktopBaseUrl: () => origin,
    controller: {
      async exportPng(template) {
        const result = await controller.exportPng(template);
        state.exports.push(result);
        return result;
      },
      cancel: () => controller.cancel(), dispose: () => controller.dispose(),
    },
  });
  app.once('before-quit', () => {
    dispose();
    session.defaultSession.webRequest.onBeforeSendHeaders(null);
    server.closeAllConnections();
    server.close();
  });
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(`${origin}/admin`);
  state.ready = true;
}
