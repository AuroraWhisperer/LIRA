'use strict';

if (process.versions.electron) run().catch(error => {
  console.error(error);
  require('electron').app.exit(1);
});

async function run() {
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const { app, BrowserWindow, session, ipcMain } = require('electron');
  const { createFontLibrary } = require('../../src/fonts/font-library');
  const { createResourceLibrary } = require('../../src/resources/resource-library');
  const { registerFontLibraryIpc } = require('../../src/electron/ipc/font-library-ipc');
  const { startComponentPreviewServer } = require('../helpers/component-preview-server');
  const [directory, archive, mode] = process.argv.slice(2);
  app.setPath('userData', path.join(directory, 'profile'));
  app.setPath('sessionData', path.join(directory, 'session'));
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  app.setAppLogsPath(path.join(directory, 'logs'));
  await app.whenReady();
  const publicDir = path.join(archive, 'public');
  const cdnDir = path.join(directory, 'cdn/upload');
  const manifest = JSON.parse(await fs.readFile(path.join(cdnDir, 'resources/manifest.json'), 'utf8'));
  let downloads = 0;
  let checks = 0;
  const downloadsReady = Promise.withResolvers();
  global.releaseCdnTestDownloads = downloadsReady.resolve;
  const resources = createResourceLibrary({ dataDir: path.join(directory, 'data'), publicDir,
    fetch: async url => {
      if (url.endsWith('/manifest.json')) {
        checks++;
        if (mode === 'offline') throw new Error('Offline cache test');
        return Response.json(manifest);
      }
      downloads++;
      await downloadsReady.promise;
      const source = decodeURIComponent(new URL(url).pathname);
      if (!/^\/resources\/(fonts|images)\/[^/]+$/.test(source)) throw new Error('Unexpected CDN file');
      return new Response(await fs.readFile(path.join(cdnDir, source.slice(1))));
    } });
  const library = createFontLibrary({ dataDir: path.join(directory, 'data'), publicDir, resources });
  global.cdnResourcesTest = { publicDir, externalRequests: [],
    get state() { return resources.getState(); }, get downloads() { return downloads; }, get checks() { return checks; } };
  const fixture = await startComponentPreviewServer({ publicDir, fontLibrary: library, resourceLibrary: resources, parentHtml: `
    <!doctype html><meta charset="utf-8"><title>CDN resources</title>
    <link rel="stylesheet" href="/css/styles-base.css">
    <link rel="stylesheet" href="/css/shared/display-fonts.css">
    <link rel="stylesheet" href="/css/admin/toasts/system.css">
    <link rel="stylesheet" href="/css/admin/toasts/desktop-update.css">
    <select aria-label="字体"><option value="">默认字体</option></select><div id="sample"></div>
    <img id="map" src="/img/admin/world-clock/earth-day-8k.png" style="width:240px" alt="世界地图">
    <div id="toast" class="toast-stack"></div>
    <script type="module" src="/js/shared/font-library-loader.js"></script>
    <script type="module">
      import { createFontLibraryToast } from '/js/admin/font-library-toast.js';
      import { registerFontSelect } from '/js/shared/font-library.js';
      import { SHARED_FONTS } from '/js/shared/font-catalog.js';
      import { renderTextBox } from '/js/shared/text-box-renderer.js';
      import { createTextBoxDefaults } from '/js/shared/text-box-config.js';
      const select = document.querySelector('select');
      createFontLibraryToast().init();
      registerFontSelect(select);
      select.addEventListener('change', () => renderTextBox(document.getElementById('sample'), {
        ...createTextBoxDefaults(), color: '#111111', nodes: [{ type: 'text',
          text: SHARED_FONTS.find(font => font.value === select.value)?.sample || '在这里输入文字', fontFamily: select.value }],
      }));
    </script>` });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(`${fixture.origin}/`);
    if (!allowed) global.cdnResourcesTest.externalRequests.push(details.url);
    callback({ cancel: !allowed });
  });
  const url = `${fixture.origin}/preview-test-host`;
  if ((await fetch(url)).status !== 200) throw new Error('Font test route unavailable');
  const window = new BrowserWindow({ show: false, webPreferences: {
    offscreen: true, backgroundThrottling: false,
    preload: path.resolve(__dirname, '../../src/electron/preload.js'),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  const trusted = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && new URL(event.senderFrame.url).origin === fixture.origin;
  const unsubscribe = registerFontLibraryIpc({
    safeHandle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => trusted(event) ? handler(...args) : { ok: false });
    },
    fontLibrary: { ...library, initialize: () => library.initialize({ force: true }) },
    licenseManager: { LicenseState: { AUTHORIZED: 'authorized' }, getState: () => 'authorized' },
    getMainWindow: () => window,
  });
  void library.initialize();
  await window.loadURL(url);
  app.once('before-quit', () => { downloadsReady.resolve(); unsubscribe(); void resources.close(); void library.close(); void fixture.close(); });
}
