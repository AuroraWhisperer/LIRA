'use strict';

if (process.versions.electron) run().catch(error => {
  console.error(error);
  require('electron').app.exit(1);
});

async function run() {
  const path = require('node:path');
  const { app, BrowserWindow, session } = require('electron');
  const { createFontLibrary } = require('../../src/fonts/font-library');
  const { startComponentPreviewServer } = require('../helpers/component-preview-server');
  const [directory, archive] = process.argv.slice(2);
  app.setPath('userData', path.join(directory, 'profile'));
  app.setPath('sessionData', path.join(directory, 'session'));
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  app.setAppLogsPath(path.join(directory, 'logs'));
  await app.whenReady();
  const publicDir = path.join(archive, 'public');
  let downloads = 0;
  const library = createFontLibrary({ dataDir: path.join(directory, 'data'), publicDir,
    fetch: async () => { downloads++; throw new Error('Offline font test'); } });
  const state = await library.initialize();
  global.bundledFontsTest = { state, downloads, publicDir, externalRequests: [] };
  const fixture = await startComponentPreviewServer({ publicDir, fontLibrary: library, parentHtml: `
    <!doctype html><meta charset="utf-8"><title>Bundled fonts</title>
    <link rel="stylesheet" href="/css/shared/display-fonts.css">
    <select aria-label="字体"><option value="">默认字体</option></select><div id="sample"></div>
    <script type="module">
      import { registerFontSelect } from '/js/shared/font-library.js';
      import { renderTextBox } from '/js/shared/text-box-renderer.js';
      import { createTextBoxDefaults } from '/js/shared/text-box-config.js';
      const select = document.querySelector('select');
      registerFontSelect(select);
      select.addEventListener('change', () => renderTextBox(document.getElementById('sample'), {
        ...createTextBoxDefaults(), color: '#111111', nodes: [{ type: 'text', text: '在这里输入文字', fontFamily: select.value }],
      }));
    </script>` });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(`${fixture.origin}/`);
    if (!allowed) global.bundledFontsTest.externalRequests.push(details.url);
    callback({ cancel: !allowed });
  });
  const url = `${fixture.origin}/preview-test-host`;
  if ((await fetch(url)).status !== 200) throw new Error('Font test route unavailable');
  const window = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  await window.loadURL(url);
  app.once('before-quit', () => { void library.close(); void fixture.close(); });
}
