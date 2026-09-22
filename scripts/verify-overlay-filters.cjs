'use strict';

// Real Electron, shipped markup/styles/preload, synthetic configuration only.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { composeAdminHtml } = require('../src/server/admin-page');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-overlay-filter-check-'));
app.setPath('userData', path.join(output, 'electron'));
const publicDir = path.resolve(__dirname, '../public');
const complete = composeAdminHtml(publicDir).replace(/\r\n/g, '\n');
const start = complete.indexOf('    <section\n      class="danmaku-feature-section danmaku-style-section"');
const end = complete.indexOf('    <section\n      class="danmaku-feature-section danmaku-compose-section"', start);
assert.ok(start >= 0 && end > start);
const script = `
import { initDanmakuOverlayFilters } from '/js/admin/danmaku-overlay-filters.js';
import { initDanmakuOverlaySettings } from '/js/admin/danmaku-overlay-settings.js';
const get = id => document.getElementById('danmaku' + id);
initDanmakuOverlaySettings({ overlayUrl:get('OverlayUrl'), styleChip:get('StyleChip'), styleSaveState:get('StyleSaveState'),
  fullscreenDurationField:get('FullscreenDurationField'), fullscreenDuration:get('FullscreenDurationSeconds'),
  copyOverlayUrlButton:get('CopyOverlayUrlBtn'), openOverlayButton:get('OpenOverlayBtn'), previewOverlayButton:get('PreviewOverlayBtn'),
  styleButtons:[...document.querySelectorAll('[data-danmaku-style]')] }, () => {});
initDanmakuOverlayFilters();
`;
const html = `<!doctype html><html class="desktop-shell" lang="zh-CN"><head><meta charset="utf-8">
${['styles-base', 'styles-admin', 'overlays/desktop'].map((name) => `<link rel="stylesheet" href="/css/${name}.css">`).join('')}
<style>body{margin:0;padding:20px;overflow:auto}.fixture-shell{max-width:1080px;margin:auto}</style>
</head><body class="desktop-shell"><div class="fixture-shell danmaku-tool-panel">${complete.slice(start, end)}</div><script type="module">${script}</script></body></html>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/admin') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(html);
  }
  const file = path.resolve(publicDir, '.' + url.pathname);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader(
    'Content-Type',
    { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }[path.extname(file)] ||
      'application/octet-stream',
  );
  res.end(fs.readFileSync(file));
});
let win,
  failWrite = false;
let settings = { blockedUsers: [], blockedKeywords: [] };
const writes = [];
const profile = {
  state: 'authorized',
  streamer: { accountName: 'synthetic', songPageUrl: 'https://synthetic.example.test' },
};
const style = {
  style: 'signal',
  fullscreenDurationSeconds: 6,
  overlayUrl: 'https://synthetic.example.test/overlay/syntheticKey_123',
};
const evaluate = (code) => win.webContents.executeJavaScript(code);
const wait = (expression) =>
  evaluate(`(async () => { const until=Date.now()+5000; while (!(${expression})) {
  if(Date.now()>until) throw Error('UI condition timed out'); await new Promise(r=>setTimeout(r,20)); } })()`);
const click = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
async function submit(form, id, value) {
  await evaluate(`{ const input=document.getElementById(${JSON.stringify(id)}); input.value=${JSON.stringify(value)};
    document.getElementById(${JSON.stringify(form)}).requestSubmit(); }`);
}
async function capture(name) {
  await evaluate('document.fonts.ready');
  const height = await evaluate(
    'Math.ceil(document.querySelector(".fixture-shell").getBoundingClientRect().height)+40',
  );
  win.setContentSize(1280, height);
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  fs.writeFileSync(
    path.join(output, name + '.png'),
    (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG(),
  );
}
async function run() {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({
    width: 1280,
    height: 1100,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../src/electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  registerLicenseIpc({
    ipcMain,
    getMainWindow: () => win,
    getDesktopBaseUrl: () => origin,
    hasExactOrigin: (url, expected) => new URL(url).origin === expected,
    licenseManager: {
      getState: () => 'authorized',
      getSnapshot: () => profile,
      getProfile: async () => profile,
      onStateChanged: () => () => {},
      getOverlaySettings: async () => style,
      getOverlayFilters: async () => structuredClone(settings),
      updateOverlayFilters: async (patch) => {
        if (failWrite) throw Object.assign(new Error(), { code: 'NETWORK_UNAVAILABLE' });
        writes.push(patch);
        settings = { ...settings, ...patch };
        return structuredClone(settings);
      },
      getOverlayViewers: async () => ({
        roomId: '998877',
        viewers: [
          { uid: '10001', name: '星河来客' },
          { uid: '10002', name: '晚风听众' },
          { uid: '10003', name: '小小月亮' },
        ],
      }),
    },
  });
  await win.loadURL(origin + '/admin?desktop=1');
  await wait('!document.getElementById("danmakuBlacklistUid").disabled');
  assert.equal(
    await evaluate(
      'document.getElementById("danmakuOverlayUrl").getBoundingClientRect().top < document.querySelector(".danmaku-style-picker").getBoundingClientRect().top',
    ),
    true,
  );
  await submit('danmakuBlacklistForm', 'danmakuBlacklistUid', '123456');
  await wait('document.querySelectorAll("#danmakuBlacklist li").length === 1');
  await submit('danmakuKeywordForm', 'danmakuKeywordInput', '示例广告');
  await wait('document.querySelectorAll("#danmakuKeywords li").length === 1');
  await capture('settings');
  await click('danmakuReadViewers');
  await wait('document.querySelectorAll("#danmakuViewerList li").length === 3');
  await evaluate(
    'document.getElementById("danmakuViewerSearch").value="晚风";document.getElementById("danmakuViewerSearch").dispatchEvent(new Event("input"))',
  );
  await evaluate('document.querySelector("#danmakuViewerList input").click()');
  const viewerGeometry = await evaluate(`(() => {
    const list=document.getElementById('danmakuViewerList');
    const box=list.querySelector('input').getBoundingClientRect();
    return { width:box.width, height:box.height, overflow:list.scrollWidth>list.clientWidth,
      nameWidth:list.querySelector('span').getBoundingClientRect().width };
  })()`);
  assert.ok(viewerGeometry.width <= 20 && viewerGeometry.height <= 20 && viewerGeometry.nameWidth > 0);
  assert.equal(viewerGeometry.overflow, false);
  await capture('viewer-picker');
  await click('danmakuAddViewers');
  await wait('document.querySelectorAll("#danmakuBlacklist li").length === 2');
  assert.deepEqual(settings.blockedUsers[1], { uid: '10002', name: '晚风听众' });
  await click('danmakuClearKeywords');
  await wait('document.querySelectorAll("#danmakuKeywords li").length === 0');
  assert.equal(settings.blockedUsers.length, 2);
  failWrite = true;
  await submit('danmakuKeywordForm', 'danmakuKeywordInput', '失败保留');
  await wait('document.getElementById("danmakuFiltersState").textContent.includes("保存失败")');
  assert.equal(await evaluate('document.getElementById("danmakuKeywordInput").value'), '失败保留');
  const overflow = await evaluate(
    '[...document.querySelectorAll(".danmaku-overlay-filters *")].filter(e=>e.getClientRects().length && e.getBoundingClientRect().right>document.documentElement.clientWidth+1).map(e=>e.id)',
  );
  assert.deepEqual(overflow, []);
  console.log(
    JSON.stringify({
      ok: true,
      screenshots: output,
      writes: writes.length,
      checks:
        'real Electron/IPC, link position, add UID, add word, search/select viewer, clear words, failed save retains input',
    }),
  );
}
run().then(
  () => finish(0),
  (error) => {
    console.error(error);
    finish(1);
  },
);
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  server.close();
  app.exit(code);
}
