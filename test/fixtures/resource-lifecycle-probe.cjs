'use strict';

if (!process.versions.electron) return;
const { app, BrowserWindow, webContents, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHttpServer } = require('../../src/server/http-server');
const { servePageOrAsset } = require('../../src/server/http-utils');
const { createWebSocketHub } = require('../../src/server/ws');
const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.setPath('sessionData', path.join(directory, 'sessions'));
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeout = 4500) {
  const until = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= until) throw new Error(message);
    await pause(20);
  }
}

async function run(mediaOnly = false) {
  const windows = new Set();
  const sockets = new Set();
  const upgrades = [];
  const token = 'synthetic-resource-audit-token';
  const settings = { giftEffectDanmakuEnabled: 'true' };
  const state = { settings, gifts: { recent: [] }, lyricState: {}, lyricTimeline: { lines: [] } };
  const api = { sessionToken: token, settings: { get: () => settings }, system: { dataDir: directory, getState: () => state } };
  const hub = createWebSocketHub({ heartbeatIntervalMs: 100, closeTimeoutMs: 100 });
  let origin;
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0, dataDir: directory,
    getPhase: () => 'ready', getStartedPort: () => server.address().port,
    isLicenseAuthorized: () => true, inflightTracker: { run: (fn) => fn() },
    createApiContext: () => api, getSettings: () => settings,
    getWebSocketContext: () => ({ sessionToken: token, allowedOrigins: [origin], getState: () => state, state: { sockets } }),
    getWebSocketHub: () => hub,
    servePageOrAsset(req, res, url) {
      if (url.pathname === '/audit-empty') { res.end('<html><title>Resource audit</title></html>'); return; }
      servePageOrAsset(path.resolve(__dirname, '../../public'), req, res, url, token);
    },
  });
  server.on('upgrade', (_req, socket) => {
    upgrades.push(socket);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  let currentMain;
  const auth = createDesktopRequestAuth({ desktopSession: session.defaultSession, getMainWindow: () => currentMain, getBaseUrl: () => origin, getToken: () => token });
  configureMediaRequestHeaders(session.defaultSession, {}, auth);
  const makeWindow = () => {
    const win = new BrowserWindow({ show: false, width: 960, height: 540, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    windows.add(win);
    win.once('closed', () => windows.delete(win));
    return win;
  };
  const report = { electron: process.versions.electron, chrome: process.versions.chrome, scenarios: [] };
  try {
    for (const route of mediaOnly ? [] : ['/gift-effects', '/lyrics', '/danmaku']) {
      const win = makeWindow();
      currentMain = win;
      auth.bindWindow(win, { openExternal() { assert.fail('unexpected external navigation'); } });
      const response = await fetch(origin + route);
      assert.equal(response.status, 200, route);
      await win.loadURL(origin + route);
      await waitFor(() => sockets.size === 1, `${route} initial connection`);
      assert.equal(await win.webContents.executeJavaScript("fetch('/api/state').then(response => response.status)"), 200, `${route} normal scoped recovery read`);
      await pause(100);
      win.webContents.debugger.attach('1.3');
      const measureDom = async () => {
        await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
        return win.webContents.debugger.sendCommand('Memory.getDOMCounters');
      };
      const initialDom = await measureDom();
      const connectionCounts = [];
      for (let cycle = 0; cycle < 5; cycle++) {
        for (const socket of [...sockets]) socket.destroy();
        await waitFor(() => sockets.size === 0, `${route} closes old connection`);
        await waitFor(() => sockets.size === 1, `${route} reconnects`);
        await pause(60);
        assert.equal(sockets.size, 1, `${route} must have exactly one connection`);
        connectionCounts.push(sockets.size);
      }
      const reconnectedDom = await measureDom();
      assert.equal(reconnectedDom.jsEventListeners, initialDom.jsEventListeners, `${route} listeners do not accumulate across reconnects`);
      win.webContents.debugger.detach();
      // Navigation destroys the old page while keeping the owning window alive.
      await win.loadURL(origin + '/audit-empty');
      await waitFor(() => sockets.size === 0, `${route} navigation releases socket`);
      await pause(2100);
      assert.equal(sockets.size, 0, `${route} old page must not reconnect`);
      const ownedContents = win.webContents;
      win.destroy();
      await waitFor(() => ownedContents.isDestroyed(), `${route} WebContents destruction completes`);
      report.scenarios.push({ route, reconnects: connectionCounts, initialDom, reconnectedDom, afterNavigation: sockets.size, webContentsDestroyed: true });
    }
    // The legacy developer page is outside the desktop's current privileged routes.
    // Preserve the current authorization boundary rather than enabling a retired page.
    const auditStatus = (await fetch(origin + '/pages/gift-audit.html')).status;
    assert.equal(auditStatus, 401);
    report.legacyGiftAudit = { anonymousHttp: auditStatus, privileged: false };
    for (let cycle = 0; cycle < (mediaOnly ? 0 : 8); cycle++) {
      const win = makeWindow();
      await win.loadURL(origin + '/gift-effects?preview=1');
      await waitFor(() => sockets.size === 1, 'recreated OBS source connection');
      await pause(120);
      win.destroy();
      await waitFor(() => sockets.size === 0, 'destroyed OBS source releases connection');
    }
    report.sourceRecreations = mediaOnly ? 0 : 8;
    const mediaWindow = makeWindow();
    await mediaWindow.loadURL(origin + '/gift-effects');
    await waitFor(() => sockets.size === 1, 'media page connection');
    report.media = await require('./gift-effect-media-probe.cjs')(mediaWindow);
    assert.equal(report.media.allVideosPaused, true);
    assert.equal(report.media.allSourcesRemoved, true);
    assert.equal(report.media.allContextsLost, true);
    assert.equal(report.media.remainingCanvas, 0);
    mediaWindow.destroy();
    await waitFor(() => sockets.size === 0, 'media window socket released');
    await waitFor(() => windows.size === 0, 'all owned windows destroyed');
    report.remainingWindows = windows.size;
    report.remainingWebContents = webContents.getAllWebContents().filter((entry) => entry.getURL().startsWith(origin)).length;
    assert.equal(report.remainingWebContents, 0);
    report.gpuFeatureStatus = app.getGPUFeatureStatus();
    return report;
  } finally {
    auth.dispose();
    for (const win of windows) win.destroy();
    hub.stop();
    for (const socket of upgrades) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { run };
globalThis.runResourceProbe = run;
if (!process.argv.includes('--interactive-audit')) {
  app.whenReady().then(run).then(
    (result) => { fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ok: true, ...result }, null, 2)); app.quit(); },
    (error) => { fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ok: false, error: error.stack }, null, 2)); app.exit(1); },
  );
}
