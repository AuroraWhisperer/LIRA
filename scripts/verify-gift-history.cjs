'use strict';

// Electron acceptance check with synthetic records, isolated SQLite and output.
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createWebSocketHub } = require('../src/server/ws');
const { servePageOrAsset } = require('../src/server/page-assets');
const { handleApi } = require('../src/server/api-routes');
const { createFixture } = require('../test/helpers/gift-query-fixture');
const { getGiftHistory, getGiftSelection, getGiftViewRevision } = require('../src/bilibili/gift/query-service');
const { GIFT_DISPLAY_SETTING, DEFAULT_GIFT_DISPLAY, validateGiftDisplaySettings } = require('../src/bilibili/gift/display-settings');
const { createGiftExportController } = require('../src/electron/gift-export-controller');
const { registerGiftExportIpc } = require('../src/electron/ipc/gift-export-ipc');
const scratch = path.resolve(__dirname, '../tmp');
fs.mkdirSync(scratch, { recursive: true });
const root = fs.mkdtempSync(path.join(scratch, 'lira-gift-ui-check-'));
app.setPath('userData', path.join(root, 'user-data'));
app.on('window-all-closed', () => {});
const publicDir = path.resolve(__dirname, '../public');
const sessionToken = randomBytes(32).toString('hex');
const fixture = createFixture({ scratchDir: root });
const source = fixture.resolveSource('a'.repeat(64));
fixture.setActiveSource(source.id, { syncState: 'LIVE', partial: false, dirty: false, epochValidated: true });
const fixtureNow = Date.parse('2026-10-15T04:00:00.000Z'); // Noon in the fixture's UTC+8 day.
function installFixtureClock(epoch) {
  const NativeDate = Date;
  const startedAt = NativeDate.now();
  globalThis.Date = class FixtureDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [FixtureDate.now()]));
    }
    static now() {
      return epoch + NativeDate.now() - startedAt;
    }
  };
}
installFixtureClock(fixtureNow);
const fixtureClockScript = `<script>(${installFixtureClock.toString()})(${fixtureNow});</script>`;
fixture.context.now = () => new Date(fixtureNow).toISOString();
for (let i = 0; i < 105; i++)
  fixture.insertGift(source.id, `fixture-${i}`, {
    createdAt: new Date(fixtureNow - (105 - i) * 1000).toISOString(),
    userName: i % 2 ? '小明' : '长昵称测试用户',
    giftName: i % 2 ? '小花花' : '测试礼物',
    unitPrice: i === 104 ? 100.01 : 100,
    totalPrice: i === 104 ? 100.01 : 100,
  });
let config = structuredClone(DEFAULT_GIFT_DISPLAY);
const fragment = fs.readFileSync(path.join(publicDir, 'pages/admin/gifts/history.html'), 'utf8');
const settingsFragment = fs.readFileSync(path.join(publicDir, 'pages/admin/toolbox/gift.html'), 'utf8');
const shellStart = fs.readFileSync(path.join(publicDir, 'pages/admin/shell-start.html'), 'utf8');
const shell = `${shellStart.slice(0, shellStart.indexOf('</header>') + '</header>'.length).replace('<body>', '<body class="desktop-shell">')}
<button id="giftHistoryOpenBtn">全部礼物流水</button>${fragment}${settingsFragment}</main>
${fixtureClockScript}
<script type="module">import { initGiftHistoryDrawer } from '/js/admin/gifts/history.js'; initGiftHistoryDrawer(); document.documentElement.classList.remove('admin-starting'); window.fixtureReady = true;</script></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  function json(data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin === 'null') return await handleApi(socketContext, req, res, url);
      let data;
      let body = '';
      if (req.method === 'POST') for await (const chunk of req) body += chunk;
      if (url.pathname === '/api/gifts/history')
        data = getGiftHistory(fixture.context, Object.fromEntries(url.searchParams));
      else if (url.pathname === '/api/gifts/selection') data = getGiftSelection(fixture.context, JSON.parse(body));
      else if (url.pathname === '/api/gifts/display-settings') {
        if (body) config = validateGiftDisplaySettings(JSON.parse(body));
        data = config;
      } else if (url.pathname === '/api/overtime/gifts/catalog') data = { gifts: [] };
      else return json({ ok: false }, 404);
      return json({ ok: true, data });
    }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(shell);
    }
    if (url.pathname === '/gift-feed') {
      const end = res.end;
      res.end = function (content, ...args) {
        if (content && res.getHeader('Content-Type')?.startsWith('text/html')) {
          content = Buffer.from(content.toString().replace('</head>', `${fixtureClockScript}</head>`));
        }
        return end.call(this, content, ...args);
      };
    }
    servePageOrAsset(publicDir, req, res, url, sessionToken);
  } catch (error) {
    json({ ok: false, code: error.code, error: error.message }, 400);
  }
});
const sockets = createWebSocketHub();
const revision = () => {
  try {
    return getGiftViewRevision(fixture.context);
  } catch {
    return null;
  }
};
const socketContext = {
  sessionToken,
  allowedOrigins: [],
  getState: () => ({ gifts: { viewRevision: revision() } }),
  settings: { get: () => ({ [GIFT_DISPLAY_SETTING]: JSON.stringify(config) }) },
  gifts: { getHistory: (query) => getGiftHistory(fixture.context, query) },
  giftCards: { getProfiles: () => ({
    viewRevision: getGiftViewRevision(fixture.context),
    day: new Date(fixtureNow + 28800000).toISOString().slice(0, 10), items: [], partial: false,
  }) },
  overtime: { getGlobalGiftCatalog: () => ({ gifts: [] }) },
};
server.on('upgrade', (req, socket, head) =>
  sockets.handleUpgrade(socketContext, req, socket, head),
);
const broadcast = (reason) => {
  sockets.broadcast({ type: 'snapshot', reason, state: { gifts: { viewRevision: revision() } } });
};
const windows = [];
let unregister;
async function evaluate(win, code) {
  return win.webContents.executeJavaScript(code);
}
async function wait(win, expression) {
  await evaluate(
    win,
    `(async () => { const end = Date.now() + 10000; while (!(${expression})) { if (Date.now() > end) throw new Error(${JSON.stringify(`Timed out: ${expression}`)}); await new Promise(r => setTimeout(r, 30)); } })()`,
  );
}
async function click(win, id) {
  await evaluate(win, `document.getElementById(${JSON.stringify(id)}).click()`);
}
async function screenshot(win, name) {
  await evaluate(
    win,
    '(async () => { await Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()',
  );
  fs.writeFileSync(
    path.join(root, name),
    (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG(),
  );
}

(async () => {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  socketContext.allowedOrigins = [origin];
  const main = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../src/electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  windows.push(main);
  const controller = createGiftExportController({
    app: { getPath: () => root },
    BrowserWindow,
    dialog: {},
    shell: {},
    getMainWindow: () => main,
    getBaseUrl: () => origin,
    runtime: {
      getSetting: () => '',
      getGiftViewRevision: () => getGiftViewRevision(fixture.context),
      prepareGiftExport: (selection) => ({
        ...getGiftSelection(fixture.context, selection),
        config: structuredClone(config),
        catalog: [],
      }),
    },
  });
  unregister = registerGiftExportIpc({
    ipcMain,
    controller,
    getMainWindow: () => main,
    getDesktopBaseUrl: () => origin,
  });
  assert.equal((await fetch(origin + '/?desktop=1')).status, 200);
  await main.loadURL(origin + '/?desktop=1');
  await wait(main, 'window.fixtureReady');
  await click(main, 'giftHistoryOpenBtn');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 100');
  await evaluate(main, 'document.querySelector("#giftHistoryBody input").click()');
  await click(main, 'giftHistoryNext');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 5');
  await evaluate(main, 'document.querySelector("#giftHistoryBody input").click()');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistorySelectedCount").textContent'), '已选 2 条');
  await screenshot(main, 'history.png');
  const bounds = await evaluate(
    main,
    `(() => {
    const drawer = document.getElementById('giftHistoryDrawer').getBoundingClientRect();
    return { top: drawer.top, left: drawer.left, width: drawer.width, height: drawer.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      footerBottom: document.querySelector('.gift-drawer-footer').getBoundingClientRect().bottom,
      navigationHidden: document.querySelector('.primary-nav-slot').getClientRects().length === 0,
      controlsHidden: document.getElementById('windowControls').getClientRects().length === 0,
      headerRegion: getComputedStyle(document.querySelector('.gift-drawer-head')).getPropertyValue('-webkit-app-region'),
      backRegion: getComputedStyle(document.getElementById('giftHistoryClose')).getPropertyValue('-webkit-app-region') };
  })()`,
  );
  assert.equal(bounds.top, 0);
  assert.equal(bounds.left, 0);
  assert.equal(bounds.width, bounds.viewportWidth);
  assert.equal(bounds.height, bounds.viewportHeight);
  assert.ok(bounds.footerBottom <= bounds.viewportHeight + 0.1, JSON.stringify(bounds));
  assert.ok(bounds.navigationHidden);
  assert.ok(bounds.controlsHidden);
  assert.equal(bounds.headerRegion, 'drag');
  assert.equal(bounds.backRegion, 'no-drag');
  await click(main, 'giftHistoryExport');
  await wait(main, 'document.getElementById("giftHistoryDrawer").dataset.view === "export"');
  assert.equal(await evaluate(main, 'document.getElementById("giftExportPreview").children.length'), 2);
  await screenshot(main, 'preview.png');
  await click(main, 'giftExportSave');
  await wait(main, 'document.getElementById("giftExportStatus").textContent === "已保存 1 张 PNG"');
  await click(main, 'giftExportBack');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistoryPageInfo").textContent'), '第 2/2 页');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistorySelectedCount").textContent'), '已选 2 条');
  await evaluate(
    main,
    'document.getElementById("giftHistoryAmountAbove").value = "100"; document.getElementById("giftHistoryFilters").requestSubmit()',
  );
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
  await evaluate(
    main,
    'document.getElementById("giftHistoryAmountAbove").value = "100.01"; document.getElementById("giftHistoryFilters").requestSubmit()',
  );
  await wait(main, 'document.getElementById("giftHistoryState").textContent === "暂无礼物记录"');
  await click(main, 'giftHistoryReset');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 100');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistoryAmountAbove").value'), '');
  await evaluate(
    main,
    'document.getElementById("giftHistoryUserQuery").value = "小明"; document.getElementById("giftHistoryGiftQuery").value = "小花";',
  );
  await click(main, 'giftHistoryToday');
  await wait(main, 'document.querySelectorAll("#giftHistoryBody input").length === 52');
  assert.equal(await evaluate(main, 'document.getElementById("giftHistorySelectedCount").textContent'), '已选 0 条');
  await click(main, 'giftHistorySelectAll');
  await wait(main, 'document.getElementById("giftHistorySelectedCount").textContent === "已选 52 条"');
  await click(main, 'giftHistoryClose');
  assert.ok(
    await evaluate(
      main,
      `!document.getElementById('giftHistoryDrawer').classList.contains('open')
    && document.querySelector('.primary-nav-slot').getClientRects().length > 0
    && getComputedStyle(document.getElementById('windowControls')).position === 'static'
    && document.activeElement.id === 'giftHistoryOpenBtn'`,
    ),
  );
  await evaluate(main, `(async () => {
    document.getElementById('giftDisplayFeature').hidden = false;
    document.getElementById('giftDisplayFeature').classList.add('active');
    const { createGiftDisplaySettings } = await import('/js/admin/gifts/display-settings.js');
    await createGiftDisplaySettings().open();
  })()`);
  await wait(main, '!document.getElementById("giftDisplayFields").disabled');
  assert.ok(await evaluate(main, 'document.getElementById("giftFeedSpeed").getClientRects().length > 0'));
  await screenshot(main, 'settings.png');
  await evaluate(main, 'document.getElementById("giftFeedSpeed").value = "50"; document.getElementById("giftDisplayForm").requestSubmit()');
  await wait(main, '!document.getElementById("giftDisplayFields").disabled && document.getElementById("giftDisplayCancel").hidden');
  assert.equal(config.scrollSpeed, 50);
  const feed = new BrowserWindow({
    width: 420,
    height: 380,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  windows.push(feed);
  assert.equal((await fetch(origin + '/gift-feed?preview=1')).status, 200);
  await feed.loadURL(origin + '/gift-feed?preview=1');
  await wait(feed, 'document.getElementById("giftFeedStage").children.length === 4');
  assert.equal(await evaluate(feed, 'document.getElementById("giftFeedStatus").textContent'), '');
  const first = await evaluate(feed, 'document.getElementById("giftFeedStage").firstElementChild.dataset.eventId');
  await wait(
    feed,
    `document.getElementById("giftFeedStage").firstElementChild.dataset.eventId !== ${JSON.stringify(first)}`,
  );
  config = { ...config, visibleRows: 1, thresholds: [1, 2, 3] };
  broadcast('settings:updated');
  await wait(feed, 'document.getElementById("giftFeedViewport").style.height === "72px"');
  fixture.clearActiveSource();
  broadcast('source:changed');
  await wait(feed, 'document.getElementById("giftFeedStage").children.length === 0');
  console.log(
    JSON.stringify({
      ok: true,
      checks:
        'cross-page selection, amount threshold/precision/reset, filtered export, filters, snapshot select-all, native save, return state, titlebar/footer, settings, 105-row browser-source loop, source clear',
      screenshots: root,
    }),
  );
})().then(
  () => finish(0),
  (error) => {
    console.error(error);
    finish(1);
  },
);
function finish(code) {
  unregister?.();
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  sockets.stop();
  server.close();
  fixture.close();
  app.exit(code);
}
