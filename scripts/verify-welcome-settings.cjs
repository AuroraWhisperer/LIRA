'use strict';

// Actual Electron renderer, real fragments/CSS/IPC, synthetic configuration only.
// LIRA_VERIFY_OUTPUT_DIR can place the unique check directory under another scratch root.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { readAdminFragment } = require('../src/server/admin-page');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const scratch = path.resolve(process.env.LIRA_VERIFY_OUTPUT_DIR || path.join(__dirname, '../tmp'));
fs.mkdirSync(scratch, { recursive: true });
const output = fs.mkdtempSync(path.join(scratch, 'welcome-check-'));
app.setPath('userData', path.join(output, 'electron'));
app.setPath('sessionData', path.join(output, 'electron'));
app.setPath('crashDumps', path.join(output, 'crashes'));
const publicDir = path.resolve(__dirname, '../public');
const fragment = readAdminFragment(publicDir, 'pages/admin/toolbox/danmaku.html');
let settings = {
  schemaVersion: 2,
  enabled: true,
  welcomeDelaySeconds: 0,
  welcomeMinHonorLevel: 0,
  greetingEnabled: false,
  greetingDelaySeconds: 10,
  greetingMinHonorLevel: 0,
  attentionEnabled: false,
  attentionMinHonorLevel: 31,
  rareNamePinyinEnabled: false,
  messages: Array.from({ length: 20 }, (_, i) => `欢迎 {username} · 样例 ${i + 1}`),
  greetingMessages: ['{username}，今天过得怎么样呀？'],
  attentionWelcomeMessages: ['{username} 来啦，很高兴见到你～'],
  attentionGreetingMessages: ['{username}，今天想听什么歌呀？'],
};
let legacy = false,
  failWrite = false,
  win;
const writes = [];
let pkSettings = {
  ok: true, enabled: false, reportEnabled: true, visitorWelcomeEnabled: false,
  visitorWelcomeDelaySeconds: 5, visitorWelcomeMessages: ['欢迎 {username} 从对面来串门～'],
};
const pkWrites = [];
const profile = {
  state: 'authorized',
  streamer: { accountName: 'synthetic', songPageUrl: 'https://synthetic.example.test' },
};
const script = `
import { initDanmakuWelcome } from '/js/admin/danmaku-welcome.js';
import { initDanmakuPkReport } from '/js/admin/danmaku-pk-report.js';
import { initFixedReplyEditor } from '/js/admin/danmaku-fixed-replies.js';
import { initDanmakuTabs } from '/js/admin/danmaku-tabs.js';
import { createCustomReplyEditor } from '/js/admin/danmaku-libraries.js';
import { toast as showToast } from '/js/shared/toast.js';
import '/js/admin/contextual-help.js';
window.fixtureToasts = [];
const toast = (message, options) => {
  window.fixtureToasts.push({ message, options });
  return showToast(message, options);
};
const saveSetting = async (key, value) => ({ [key]: value });
document.getElementById('otherDanmakuFeature').hidden = false;
document.getElementById('otherDanmakuFeature').classList.add('active');
createCustomReplyEditor({ document, saveSetting, toast }).load('[]');
initDanmakuWelcome({ toast }); initDanmakuPkReport({ toast }); initFixedReplyEditor(); initDanmakuTabs();
document.querySelector('[data-danmaku-tab="welcome"]').click();
window.fixtureReady = true;
`;
const html = `<!doctype html><html class="desktop-shell" lang="zh-CN"><head><meta charset="utf-8">
${['styles-base', 'styles-admin', 'overlays/desktop'].map((name) => `<link rel="stylesheet" href="/css/${name}.css">`).join('')}
<style>body{margin:0;padding:20px;overflow:auto}.fixture-shell{max-width:1000px;margin:auto}</style>
</head><body class="desktop-shell"><div class="fixture-shell">${fragment}</div><div id="toast" class="toast-stack"></div><script type="module">${script}</script></body></html>`;
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
const evaluate = (code) => win.webContents.executeJavaScript(code);
const wait = (expression) =>
  evaluate(
    `(async () => { const until=Date.now()+8000; while (!(${expression})) { if(Date.now()>until) throw Error(${JSON.stringify('UI condition timed out: ' + expression)}); await new Promise(r=>setTimeout(r,20)); } })()`,
  );
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function closeEditor() {
  if (!await evaluate('document.getElementById("danmakuFixedEditorDialog").open')) return;
  await click('#danmakuFixedEditorDismiss');
  await wait('!document.getElementById("danmakuFixedEditorDialog").open && document.getElementById("danmakuFixedEditorHeading").hidden');
}
async function openEditor(key) {
  await closeEditor();
  await click(`[data-danmaku-tab="${['welcome', 'pk'].includes(key) ? 'welcome' : 'replies'}"]`);
  await click(`[data-fixed-open="${key}"]`);
  await wait('document.getElementById("danmakuFixedEditorDialog").open');
  await evaluate('Promise.all(document.getElementById("danmakuFixedEditorDialog").getAnimations().map(animation => animation.finished))');
}
const input = (id, value) =>
  evaluate(
    `{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
async function key(keyCode) {
  const input = {
    key: keyCode === 'Space' ? ' ' : keyCode,
    code: keyCode,
    windowsVirtualKeyCode: { Enter: 13, Tab: 9, Space: 32 }[keyCode],
  };
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...input,
    text: keyCode === 'Enter' ? '\r' : keyCode === 'Space' ? ' ' : '',
  });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...input });
  await evaluate('new Promise(r => requestAnimationFrame(r))');
}
async function capture(name) {
  await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  fs.writeFileSync(
    path.join(output, name + '.png'),
    (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG(),
  );
}
async function geometry() {
  return evaluate(`(() => {
    const root=document.getElementById('danmakuFixedEditorDialog');
    const overflow=[...root.querySelectorAll('*')].filter(e=>e.getClientRects().length && getComputedStyle(e).position!=='absolute' && e.getBoundingClientRect().right > document.documentElement.clientWidth+1).map(e=>e.id||e.className);
    return { open:root.open, height:root.getBoundingClientRect().height, overflow, visible:[...root.querySelectorAll('[data-fixed-editor]')].filter(e=>!e.hidden).map(e=>e.dataset.fixedEditor) };
  })()`);
}
async function run() {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/admin?desktop=1')).status, 200);
  win = new BrowserWindow({
    width: 1280,
    height: 800,
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
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error('renderer:', event.message);
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
      getWelcomeSettingsV2: async () =>
        legacy ? { schemaVersion: 1, enabled: settings.enabled, messages: settings.messages } : settings,
      getPkReportSettings: async () => legacy ? { ok: true, enabled: pkSettings.enabled } : pkSettings,
      updatePkReportSettings: async (patch) => {
        if (failWrite) throw Object.assign(Error(), { code: 'NETWORK_UNAVAILABLE' });
        pkWrites.push(patch);
        pkSettings = { ...pkSettings, ...patch };
        return pkSettings;
      },
      updateWelcomeSettingsV2: async (patch) => {
        if (failWrite) throw Object.assign(Error(), { code: 'NETWORK_UNAVAILABLE' });
        writes.push(patch);
        settings = { ...settings, ...patch };
        if (!settings.enabled) settings = { ...settings, greetingEnabled: false, attentionEnabled: false };
        return settings;
      },
    },
  });
  await win.loadURL(origin + '/admin?desktop=1');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await wait('window.fixtureReady && !document.getElementById("danmakuWelcomeToggle").disabled');
  const collapsed = await geometry();
  assert.equal(collapsed.open, false);
  assert.deepEqual(collapsed.visible, []);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomePinyinToggle").getClientRects().length'), 0);
  await capture('collapsed');
  await wait('!document.getElementById("danmakuPkReportToggle").disabled');
  await click('#danmakuPkReportToggle');
  await wait('document.getElementById("danmakuPkReportToggle").checked && !document.getElementById("danmakuPkReportToggle").disabled');
  await openEditor('pk');
  await click('#danmakuPkReportReportToggle');
  await wait('!document.getElementById("danmakuPkReportReportToggle").disabled');
  await click('#danmakuPkReportVisitorToggle');
  await wait('!document.getElementById("danmakuPkReportVisitorToggle").disabled');
  await input('danmakuPkReportDelay', '8');
  await input('danmakuPkReportInput', '欢迎 {username} 来坐坐～');
  await click('#danmakuPkReportAddBtn');
  await openEditor('welcome');
  await openEditor('pk');
  assert.equal(await evaluate('document.getElementById("danmakuPkReportDelay").value'), '8');
  await click('#danmakuPkReportSaveBtn');
  await wait('document.getElementById("danmakuPkReportSaveBtn").disabled && !document.getElementById("danmakuPkReportToggle").disabled');
  assert.deepEqual(pkWrites.at(-1), { visitorWelcomeDelaySeconds: 8,
    visitorWelcomeMessages: ['欢迎 {username} 从对面来串门～', '欢迎 {username} 来坐坐～'] });
  await win.loadURL(origin + '/admin?desktop=1');
  await wait('window.fixtureReady && !document.getElementById("danmakuPkReportToggle").disabled');
  await openEditor('pk');
  assert.equal(await evaluate('document.getElementById("danmakuPkReportDelay").value'), '8');
  assert.equal(await evaluate('document.querySelectorAll("#danmakuPkReportList input").length'), 2);
  assert.equal(await evaluate('document.getElementById("danmakuPkReportReportToggle").checked'), false);
  assert.equal(await evaluate('document.getElementById("danmakuPkReportVisitorToggle").checked'), true);
  await evaluate('document.getElementById("danmakuFixedEditorHeading").scrollIntoView({block:"start"})');
  await capture('pk');
  await openEditor('welcome');
  const expanded = await geometry();
  assert.equal(expanded.open, true);
  assert.deepEqual(expanded.visible, ['welcome']);
  assert.equal(
    await evaluate('document.getElementById("danmakuWelcomePinyinToggle").closest("#danmakuWelcomePanel") !== null'),
    true,
  );
  assert.deepEqual(expanded.overflow, []);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomePreview") === null'), true);
  await capture('welcome');
  await evaluate('document.documentElement.style.colorScheme="dark"');
  await capture('dark-tokens');
  await evaluate('document.documentElement.style.colorScheme="light"');
  await evaluate('document.getElementById("danmakuFixedEditorDismiss").focus()');
  await key('Enter');
  await wait('document.getElementById("danmakuFixedEditorHeading").hidden');
  assert.deepEqual((await geometry()).visible, []);
  assert.equal(await evaluate('document.activeElement.dataset.fixedOpen'), 'welcome');
  await key('Enter');
  assert.deepEqual((await geometry()).visible, ['welcome']);
  await closeEditor();
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.id'), 'danmakuWelcomeToggle');
  await key('Space');
  await wait('!document.getElementById("danmakuWelcomeToggle").disabled');
  assert.equal(settings.enabled, false);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeGreetingToggle").disabled'), true);
  await capture('disabled');
  await evaluate('document.getElementById("danmakuWelcomeToggle").focus()');
  await key('Space');
  await wait('!document.getElementById("danmakuWelcomeToggle").disabled');
  assert.equal(settings.enabled, true);
  await openEditor('welcome');
  writes.length = 0;
  await input('danmakuWelcomewelcomeDelaySeconds', '5');
  await openEditor('diy');
  await input('danmakuCustomKeywordInput', '未添加的关键词草稿');
  await openEditor('welcome');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomewelcomeDelaySeconds").value'), '5');
  await click('#danmakuWelcomeParameterSaveBtn');
  await wait('document.getElementById("danmakuWelcomeParameterSaveBtn").disabled');
  assert.equal(writes[0].welcomeDelaySeconds, 5);
  assert.ok(!writes[0].messages);
  await openEditor('diy');
  assert.equal(await evaluate('document.getElementById("danmakuCustomKeywordInput").value'), '未添加的关键词草稿');
  await openEditor('welcome');
  await click('[data-welcome-library="messages"]');
  await wait('!document.getElementById("danmakuWelcomePagination").hidden && !document.getElementById("danmakuWelcomeNextPage").disabled');
  await click('#danmakuWelcomeNextPage');
  await wait('!document.getElementById("danmakuWelcomePrevPage").disabled');
  await input('danmakuWelcomeInput', '未添加的欢迎草稿');
  await openEditor('random');
  await openEditor('welcome');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeInput").value'), '未添加的欢迎草稿');
  assert.match(await evaluate('document.getElementById("danmakuWelcomePageLabel").textContent'), /第 2/);
  await click('[data-welcome-view="parameters"]');
  for (const width of [704, 640, 480, 360, 320]) {
    win.setContentSize(width, 900);
    await evaluate('new Promise(r=>requestAnimationFrame(r))');
    const result = await geometry();
    assert.deepEqual(result.overflow, [], `width ${width}`);
    await capture(`width-${width}`);
  }
  win.setContentSize(1280, 900);
  win.webContents.setZoomFactor(2);
  await evaluate('new Promise(r=>requestAnimationFrame(r))');
  assert.deepEqual((await geometry()).overflow, []);
  await capture('zoom-200');
  win.webContents.setZoomFactor(1);
  await input('danmakuWelcomegreetingDelaySeconds', '4');
  await click('#danmakuWelcomeGreetingToggle');
  assert.equal(
    await evaluate('document.getElementById("danmakuWelcomegreetingDelaySeconds").getAttribute("aria-invalid")'),
    'true',
  );
  await capture('invalid');
  const overviewText = await evaluate('document.getElementById("danmakuWelcomeOverviewStatus").textContent');
  const summaryText = await evaluate('document.getElementById("danmakuWelcomeSummary").textContent');
  const previousWrites = writes.length;
  await evaluate('window.fixtureToasts.length = 0');
  await click('#danmakuWelcomePinyinToggle');
  await wait('!document.getElementById("danmakuWelcomePinyinToggle").disabled');
  assert.equal(writes.length, previousWrites + 1);
  assert.deepEqual(writes.at(-1), { rareNamePinyinEnabled: true });
  assert.equal(await evaluate('document.getElementById("danmakuWelcomegreetingDelaySeconds").value'), '4');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeOverviewStatus").textContent'), overviewText);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeSummary").textContent'), summaryText);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomePinyinToggle").checked'), true);
  await capture('pinyin-saved');
  failWrite = true;
  await click('#danmakuWelcomePinyinToggle');
  await wait('window.fixtureToasts.length === 1');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomePinyinToggle").checked'), true);
  assert.equal(await evaluate('window.fixtureToasts[0].options.type'), 'error');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeOverviewStatus").textContent'), overviewText);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeServerStatus").hidden'), true);
  await wait(`Array.from(document.querySelectorAll('#toast .toast-error')).some(node =>
    !node.hidden && node.getBoundingClientRect().height > 0 && getComputedStyle(node).opacity === '1'
    && node.textContent.includes('昵称生僻字自动注音关闭尚未确认'))`);
  await capture('pinyin-error');
  await closeEditor();
  await click('#danmakuWelcomeToggle');
  await wait('window.fixtureToasts.length === 2');
  assert.match(await evaluate('window.fixtureToasts[1].message'), /关闭尚未确认/);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeToggle").checked'), true);
  await capture('unconfirmed');
  legacy = true;
  failWrite = false;
  await win.reload();
  await wait('window.fixtureReady && !document.getElementById("danmakuWelcomeToggle").disabled');
  await openEditor('welcome');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeCapability").hidden'), false);
  await capture('legacy');
  console.log(
    JSON.stringify({
      ok: true,
      collapsed,
      expanded,
      screenshots: output,
      isolation: { pid: process.pid, userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), origin },
      checks:
        'real Electron/IPC, current toolbox fragment and shared dialog, PK master/subswitches and welcome settings save/readback, keyboard and disabled state, local and server drafts, pagination counts, responsive widths, 200% zoom, invalid input, independent pinyin toggle, single error toast, unconfirmed close, legacy capability',
    }),
  );
}
run().then(
  () => finish(0),
  async (error) => {
    console.error(error);
    if (win && !win.isDestroyed()) console.error(await evaluate(`JSON.stringify({
      ready: window.fixtureReady,
      welcome: document.getElementById('danmakuWelcomeStatus')?.textContent,
      overview: document.getElementById('danmakuWelcomeOverviewStatus')?.textContent,
      pk: document.getElementById('danmakuPkReportStatus')?.textContent,
      toasts: window.fixtureToasts
    })`));
    finish(1);
  },
);
function finish(code) {
  if (win && !win.isDestroyed()) win.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(code);
}
