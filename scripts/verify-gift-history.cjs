'use strict';

// Electron acceptance check with synthetic records, isolated SQLite and output.
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createWebSocketHub } = require('../src/server/ws');
const { createFixture } = require('../test/helpers/gift-query-fixture');
const { getGiftHistory, getGiftSelection, getGiftViewRevision } = require('../src/bilibili/gift/query-service');
const { DEFAULT_GIFT_DISPLAY, validateGiftDisplaySettings } = require('../src/bilibili/gift/display-settings');
const { createGiftExportController } = require('../src/electron/gift-export-controller');
const { registerGiftExportIpc } = require('../src/electron/ipc/gift-export-ipc');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-ui-check-'));
app.setPath('userData', path.join(root, 'user-data'));
app.on('window-all-closed', () => {});
const publicDir = path.resolve(__dirname, '../public');
const fixture = createFixture();
const source = fixture.resolveSource('a'.repeat(64));
fixture.setActiveSource(source.id, { syncState: 'LIVE', partial: false, dirty: false, epochValidated: true });
fixture.context.now = () => new Date().toISOString();
for (let i = 0; i < 55; i++) fixture.insertGift(source.id, `fixture-${i}`, {
  createdAt: new Date(Date.now() - (55 - i) * 1000).toISOString(),
  userName: i % 2 ? '小明' : '长昵称测试用户', giftName: i % 2 ? '小花花' : '测试礼物', unitPrice: i === 54 ? 100.01 : 100, totalPrice: i === 54 ? 100.01 : 100,
});
let config = structuredClone(DEFAULT_GIFT_DISPLAY);
const fragment = fs.readFileSync(path.join(publicDir, 'pages/admin/gifts/history.html'), 'utf8');
const shellStart = fs.readFileSync(path.join(publicDir, 'pages/admin/shell-start.html'), 'utf8');
const shell = `${shellStart.slice(0, shellStart.indexOf('</header>') + '</header>'.length).replace('<body>', '<body class="desktop-shell">')}
<button id="giftHistoryOpenBtn">全部礼物流水</button>${fragment}</main>
<script type="module">import { initGiftHistoryDrawer } from '/js/admin/gifts/history.js'; initGiftHistoryDrawer(); window.fixtureReady = true;</script></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  function json(data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
  try {
    if (url.pathname.startsWith('/api/')) {
      let data;
      let body = '';
      if (req.method === 'POST') for await (const chunk of req) body += chunk;
      if (url.pathname === '/api/gifts/history') data = getGiftHistory(fixture.context, Object.fromEntries(url.searchParams));
      else if (url.pathname === '/api/gifts/selection') data = getGiftSelection(fixture.context, JSON.parse(body));
      else if (url.pathname === '/api/gifts/display-settings') { if (body) config = validateGiftDisplaySettings(JSON.parse(body)); data = config; }
      else if (url.pathname === '/api/overtime/gifts/catalog') data = { gifts: [] };
      else return json({ ok: false }, 404);
      return json({ ok: true, data });
    }
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(shell); }
    const relative = { '/gift-export': '/pages/overlays/gift-export.html', '/gift-feed': '/pages/overlays/gift-feed.html' }[url.pathname] || url.pathname;
    const file = path.join(publicDir, relative);
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch (error) { json({ ok: false, code: error.code, error: error.message }, 400); }
});
const sockets = createWebSocketHub();
const revision = () => { try { return getGiftViewRevision(fixture.context); } catch { return null; } };
server.on('upgrade', (req, socket) => sockets.handleUpgrade({ getState: () => ({ gifts: { viewRevision: revision() } }) }, req, socket));
const broadcast = (reason) => {
  sockets.broadcast({ type: 'snapshot', reason, state: { gifts: { viewRevision: revision() } } });
};
const windows = [];
let unregister;
async function evaluate(win, code) { return win.webContents.executeJavaScript(code); }
async function wait(win, expression) {
  await evaluate(win, `(async () => { const end = Date.now() + 10000; while (!(${expression})) { if (Date.now() > end) throw new Error(${JSON.stringify(`Timed out: ${expression}`)}); await new Promise(r => setTimeout(r, 30)); } })()`);
}
async function click(win, id) { await evaluate(win, `document.getElementById(${JSON.stringify(id)}).click()`); }
async function screenshot(win, name) {
  await evaluate(win, '(async () => { await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()');
  fs.writeFileSync(path.join(root, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}

(async () => {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const main = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false,
    webPreferences: { preload: path.resolve(__dirname, '../src/electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } });
  windows.push(main);
  const controller = createGiftExportController({ app: { getPath: () => root }, BrowserWindow, dialog: {}, shell: {},
    getMainWindow: () => main, getBaseUrl: () => origin,
    runtime: { getSetting: () => '', getGiftViewRevision: () => getGiftViewRevision(fixture.context),
      prepareGiftExport: (selection) => ({ ...getGiftSelection(fixture.context, selection), config: structuredClone(config), catalog: [] }) } });
  unregister = registerGiftExportIpc({ ipcMain, controller, getMainWindow: () => main, getDesktopBaseUrl: () => origin });
  await main.loadURL(origin + '/?desktop=1');
  await wait(main, 'window.fixtureReady');
  await click(main, 'giftHistoryOpenBtn');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 50');
  await evaluate(main, 'document.querySelector("#giftHistoryBody input").click()');
  await click(main, 'giftHistoryNext');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 5');
  await evaluate(main, 'document.querySelector("#giftHistoryBody input").click()');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistorySelectedCount").textContent'), '已选 2 条');
  await screenshot(main, 'history.png');
  const bounds = await evaluate(main, `(() => {
    const drawer = document.getElementById('giftHistoryDrawer').getBoundingClientRect();
    const controls = document.getElementById('windowControls').getBoundingClientRect();
    const clear = document.getElementById('giftHistoryClearDatabaseBtn').getBoundingClientRect();
    return { top: drawer.top, left: drawer.left, width: drawer.width, height: drawer.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      footerBottom: document.querySelector('.gift-drawer-footer').getBoundingClientRect().bottom,
      navigationHidden: document.querySelector('.primary-nav-slot').getClientRects().length === 0,
      controlsSeparate: clear.right < controls.left,
      controlsClickable: ['winMinBtn', 'winMaxBtn', 'winCloseBtn'].every((id) => {
        const button = document.getElementById(id);
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }),
      headerRegion: getComputedStyle(document.querySelector('.gift-drawer-head')).getPropertyValue('-webkit-app-region'),
      backRegion: getComputedStyle(document.getElementById('giftHistoryClose')).getPropertyValue('-webkit-app-region') };
  })()`);
  assert.equal(bounds.top, 0); assert.equal(bounds.left, 0);
  assert.equal(bounds.width, bounds.viewportWidth); assert.equal(bounds.height, bounds.viewportHeight);
  assert.ok(bounds.footerBottom <= bounds.viewportHeight + 0.1, JSON.stringify(bounds));
  assert.ok(bounds.navigationHidden); assert.ok(bounds.controlsSeparate); assert.ok(bounds.controlsClickable);
  assert.equal(bounds.headerRegion, 'drag'); assert.equal(bounds.backRegion, 'no-drag');
  await click(main, 'giftHistoryExport');
  await wait(main, 'document.getElementById("giftHistoryDrawer").dataset.view === "export"');
  assert.equal(await evaluate(main, 'document.getElementById("giftExportPreview").children.length'), 2);
  await screenshot(main, 'preview.png');
  await click(main, 'giftExportSave');
  await wait(main, 'document.getElementById("giftExportStatus").textContent === "已保存 1 张"');
  await click(main, 'giftExportBack');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistoryPageInfo").textContent'), '第 2/2 页');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistorySelectedCount").textContent'), '已选 2 条');
  await evaluate(main, 'document.getElementById("giftHistoryAmountAbove").value = "100"; document.getElementById("giftHistoryFilters").requestSubmit()');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 1');
  assert.ok(await evaluate(main, 'document.getElementById("giftHistoryBody").textContent.includes("¥100.01")'));
  assert.equal(await evaluate(main, 'document.getElementById("giftHistoryPageInfo").textContent'), '第 1/1 页');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistorySelectedCount").textContent'), '已选 0 条');
  await click(main, 'giftHistorySelectAll');
  await wait(main, 'document.getElementById("giftHistorySelectedCount").textContent === "已选 1 条"');
  await screenshot(main, 'amount-filter.png');
  await click(main, 'giftHistoryExport');
  await wait(main, 'document.getElementById("giftHistoryDrawer").dataset.view === "export"');
  assert.equal(await evaluate(main, 'document.getElementById("giftExportPreview").children.length'), 1);
  await click(main, 'giftExportBack');
  await evaluate(main, 'document.getElementById("giftHistoryAmountAbove").value = "100.01"; document.getElementById("giftHistoryFilters").requestSubmit()');
  await wait(main, 'document.getElementById("giftHistoryState").textContent === "暂无礼物记录"');
  await click(main, 'giftHistoryReset');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 50');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistoryAmountAbove").value'), '');
  await evaluate(main, 'document.getElementById("giftHistoryUserQuery").value = "小明"; document.getElementById("giftHistoryGiftQuery").value = "小花";');
  await click(main, 'giftHistoryToday');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 27');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistorySelectedCount").textContent'), '已选 0 条');
  await click(main, 'giftHistorySelectAll');
  await wait(main, 'document.getElementById("giftHistorySelectedCount").textContent === "已选 27 条"');
  await click(main, 'giftDisplaySettingsOpen');
  await wait(main, 'document.getElementById("giftHistoryDrawer").dataset.view === "settings"');
  await screenshot(main, 'settings.png');
  await evaluate(main, 'document.getElementById("giftFeedInterval").value = "2"; document.getElementById("giftDisplayForm").requestSubmit()');
  await wait(main, 'document.getElementById("giftHistoryDrawer").dataset.view === "list"');
  assert.equal(config.intervalSeconds, 2);
  await click(main, 'giftHistoryClose');
  assert.ok(await evaluate(main, `!document.getElementById('giftHistoryDrawer').classList.contains('open')
    && document.querySelector('.primary-nav-slot').getClientRects().length > 0
    && getComputedStyle(document.getElementById('windowControls')).position === 'static'
    && document.activeElement.id === 'giftHistoryOpenBtn'`));
  const feed = new BrowserWindow({ width: 420, height: 380, show: false, webPreferences: { backgroundThrottling: false } });
  windows.push(feed);
  await feed.loadURL(origin + '/gift-feed?preview=1');
  await wait(feed, 'document.getElementById("giftFeedStage").children.length === 4');
  await wait(feed, 'document.getElementById("giftFeedStatus").textContent.includes("55 条")');
  const first = await evaluate(feed, 'document.getElementById("giftFeedStage").firstElementChild.dataset.eventId');
  await wait(feed, `document.getElementById("giftFeedStage").firstElementChild.dataset.eventId !== ${JSON.stringify(first)}`);
  config = { ...config, visibleRows: 1, paused: true, thresholds: [1, 2, 3] };
  broadcast('settings:updated');
  await wait(feed, 'document.getElementById("giftFeedViewport").style.height === "96px"');
  fixture.clearActiveSource();
  broadcast('source:changed');
  await wait(feed, 'document.getElementById("giftFeedStage").children.length === 0');
  console.log(JSON.stringify({ ok: true, checks: 'cross-page selection, amount threshold/precision/reset, filtered export, filters, snapshot select-all, native save, return state, titlebar/footer, settings, 55-row OBS loop, source clear', screenshots: root }));
})().then(() => finish(0), (error) => { console.error(error); finish(1); });
function finish(code) {
  unregister?.();
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  sockets.stop(); server.close(); fixture.close(); app.exit(code);
}
