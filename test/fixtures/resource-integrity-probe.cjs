'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const rawFs = require('original-fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createResourceIntegrityManager } = require('../../src/electron/resource-integrity-manager');
const { registerUpdateIpc } = require('../../src/electron/ipc/update-ipc');

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'user-data'));
app.setPath('sessionData', path.join(directory, 'session-data'));
app.setAppLogsPath(path.join(directory, 'logs'));
const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const html = `<!doctype html><html lang="zh-CN" class="desktop-shell"><head><meta charset="utf-8">
<style>${read('public/css/styles-base.css')}${read('public/css/desktop/palettes.css')}${read('public/css/desktop/theme.css')}${read('public/css/desktop/update.css')}</style></head><body class="desktop-shell">
${read('public/pages/admin/toolbox/desktop-update.html')}
<script>window.AdminApp={utils:{toast(){}}};</script>
<script>${read('public/js/desktop.js')}</script>
<script>document.getElementById('otherDesktopUpdateFeature').hidden=false;window.AdminApp.desktop.initResourceIntegrity(window.songAssistantDesktop);</script>
</body></html>`;
let window;
let manager;
let heartbeat;
let beats = 0;
let server;

async function clickAndWait() {
  return window.webContents.executeJavaScript(`(async () => {
    const bridge = window.songAssistantDesktop;
    window.AdminApp.desktop.renderResourceIntegrityState(await bridge.getResourceIntegrityState());
    return new Promise((resolve) => {
      let ticks = 0;
      const interval = setInterval(() => { ticks += 1; }, 10);
      const unsubscribe = bridge.onResourceIntegrityState(async (state) => {
        if (state.status === 'checking') return;
        clearInterval(interval);
        unsubscribe();
        await new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted)));
        resolve({ state, ticks, text: document.getElementById('desktopIntegrityStatus').textContent });
      });
      document.getElementById('desktopIntegrityCheckBtn').click();
    });
  })()`);
}

async function run() {
  await app.whenReady();
  // A test-only loopback server; it never starts LIRA's backend or reads its state.
  server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${baseUrl}/admin`)).status, 200);
  manager = createResourceIntegrityManager({
    fs: rawFs,
    resourcesDir: path.join(directory, 'resources'),
    appVersion: '1.0.0',
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
    onStateChange(state) {
      if (window && !window.isDestroyed()) window.webContents.send('desktop:resource-integrity-state', state);
    },
  });
  registerUpdateIpc({
    ipcMain,
    app,
    resourceIntegrity: manager,
    getMainWindow: () => window,
    getDesktopBaseUrl: () => baseUrl,
  });
  window = new BrowserWindow({
    show: false,
    width: 1050,
    height: 800,
    webPreferences: {
      preload: path.join(root, 'src/electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(`${baseUrl}/admin`);
  heartbeat = setInterval(() => {
    beats += 1;
  }, 10);
  const first = await clickAndWait();
  clearInterval(heartbeat);
  assert.equal(first.state.status, 'passed');
  assert.match(first.text, /检查通过，未发现资源异常/);
  await window.webContents
    .capturePage()
    .then((image) => fs.writeFileSync(path.join(directory, 'passed.png'), image.toPNG()));
  assert.ok(beats > 0 && first.ticks > 0, 'Main and renderer event loops should respond while streaming');
  const archive = path.join(directory, 'resources/app.asar');
  const handle = await rawFs.promises.open(archive, 'r+');
  try {
    await handle.write(Buffer.from([1]), 0, 1, (await handle.stat()).size - 1);
  } finally {
    await handle.close();
  }
  const changed = await clickAndWait();
  assert.equal(changed.state.status, 'issues');
  assert.equal(changed.state.details[0].reasonCode, 'HASH_MISMATCH');
  assert.match(changed.text, /发现 1 项资源异常/);
  await window.webContents
    .capturePage()
    .then((image) => fs.writeFileSync(path.join(directory, 'issues.png'), image.toPNG()));
  await window.loadURL(`${baseUrl}/license`);
  assert.deepEqual(await window.webContents.executeJavaScript('window.songAssistantDesktop.checkResourceIntegrity()'), {
    ok: false,
    error: 'IPC_SOURCE_INVALID',
  });
  return {
    ok: true,
    firstStatus: first.state.status,
    changedStatus: changed.state.status,
    mainBeats: beats,
    rendererBeats: first.ticks,
  };
}

run()
  .then((result) => {
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result));
  })
  .catch((error) => {
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  })
  .finally(async () => {
    clearInterval(heartbeat);
    await manager?.stop();
    window?.destroy();
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    app.exit(process.exitCode || 0);
  });
