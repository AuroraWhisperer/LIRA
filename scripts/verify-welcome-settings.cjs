'use strict';

// Actual Electron renderer, real fragments/CSS/IPC, synthetic configuration only.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { composeAdminHtml } = require('../src/server/admin-page');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const scratch = path.resolve(__dirname, '../tmp');
fs.mkdirSync(scratch, { recursive: true });
const output = fs.mkdtempSync(path.join(scratch, 'welcome-check-'));
app.setPath('userData', path.join(output, 'electron'));
app.setPath('sessionData', path.join(output, 'electron'));
const publicDir = path.resolve(__dirname, '../public');
const complete = composeAdminHtml(publicDir);
const start = complete.indexOf('id="otherDanmakuFeature"');
const begin = complete.search(/<section\s+class="danmaku-feature-section danmaku-fixed-reply-section"/);
const end = complete.slice(begin).search(/\r?\n  <\/div>\r?\n<\/section>/);
const fixed = complete.slice(begin, begin + end);
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
const profile = {
  state: 'authorized',
  streamer: { accountName: 'synthetic', songPageUrl: 'https://synthetic.example.test' },
};
const script = `
import { initDanmakuWelcome } from '/js/admin/danmaku-welcome.js';
import { initDanmakuPkReport } from '/js/admin/danmaku-pk-report.js';
import { initFixedReplyEditor } from '/js/admin/danmaku-fixed-replies.js';
import { createCustomReplyEditor } from '/js/admin/danmaku-libraries.js';
import { toast as showToast } from '/js/shared/toast.js';
import '/js/admin/contextual-help.js';
window.fixtureToasts = [];
const toast = (message, options) => {
  window.fixtureToasts.push({ message, options });
  return showToast(message, options);
};
const saveSetting = async (key, value) => ({ [key]: value });
createCustomReplyEditor({ document, saveSetting, toast }).load('[]');
initDanmakuWelcome({ toast }); initDanmakuPkReport({ toast }); initFixedReplyEditor();
window.fixtureReady = true;
`;
const html = `<!doctype html><html class="desktop-shell" lang="zh-CN"><head><meta charset="utf-8">
${['styles-base', 'styles-admin', 'overlays/desktop'].map((name) => `<link rel="stylesheet" href="/css/${name}.css">`).join('')}
<style>body{margin:0;padding:20px;overflow:auto}.fixture-shell{max-width:1000px;margin:auto}.danmaku-tool-panel{display:block}.fixture-shell>.danmaku-feature-section{margin:0}</style>
</head><body class="desktop-shell"><div class="fixture-shell danmaku-tool-panel">${fixed}</div><div id="toast" class="toast-stack"></div><script type="module">${script}</script></body></html>`;
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
    `(async () => { const until=Date.now()+8000; while (!(${expression})) { if(Date.now()>until) throw Error('UI condition timed out'); await new Promise(r=>setTimeout(r,20)); } })()`,
  );
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
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
    const root=document.querySelector('.danmaku-fixed-reply-section');
    const overflow=[...root.querySelectorAll('*')].filter(e=>e.getClientRects().length && getComputedStyle(e).position!=='absolute' && e.getBoundingClientRect().right > document.documentElement.clientWidth+1).map(e=>e.id||e.className);
    return { height:root.getBoundingClientRect().height, gap:getComputedStyle(root).gap, parts:[...root.children].filter(e=>e.getClientRects().length).map(e=>[e.id||e.className,e.getBoundingClientRect().height]), columns:getComputedStyle(document.querySelector('.danmaku-fixed-overview')).gridTemplateColumns.split(' ').length, overflow, visible:[...document.querySelectorAll('[data-fixed-editor]')].filter(e=>!e.hidden).map(e=>e.dataset.fixedEditor) };
  })()`);
}
async function run() {
  assert.ok(start >= 0 && begin > start && end > 0);
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
      getPkReportSettings: async () => ({ ok: true, enabled: false }),
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
  assert.equal(collapsed.columns, 2);
  assert.deepEqual(collapsed.visible, []);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomePinyinToggle").getClientRects().length'), 0);
  assert.equal(await evaluate('document.querySelectorAll(".switch-caption").length'), 0);
  await capture('collapsed');
  await click('[data-fixed-open="welcome"]');
  const expanded = await geometry();
  assert.deepEqual(expanded.visible, ['welcome']);
  assert.equal(
    await evaluate('document.getElementById("danmakuWelcomePinyinToggle").closest("#danmakuWelcomePanel") !== null'),
    true,
  );
  assert.deepEqual(expanded.overflow, []);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomePreview").open'), false);
  await capture('welcome');
  await evaluate('document.documentElement.style.colorScheme="dark"');
  await capture('dark-tokens');
  await evaluate('document.documentElement.style.colorScheme="light"');
  await evaluate('document.getElementById("danmakuFixedEditorClose").focus()');
  await key('Enter');
  assert.deepEqual((await geometry()).visible, []);
  assert.equal(await evaluate('document.activeElement.dataset.fixedOpen'), 'welcome');
  await key('Enter');
  assert.deepEqual((await geometry()).visible, ['welcome']);
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
  writes.length = 0;
  await input('danmakuWelcomewelcomeDelaySeconds', '5');
  await click('[data-fixed-open="diy"]');
  await input('danmakuCustomKeywordInput', '未添加的关键词草稿');
  await click('[data-fixed-open="welcome"]');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomewelcomeDelaySeconds").value'), '5');
  await click('#danmakuWelcomeParameterSaveBtn');
  await wait('document.getElementById("danmakuWelcomeParameterSaveBtn").disabled');
  assert.equal(writes[0].welcomeDelaySeconds, 5);
  assert.ok(!writes[0].messages);
  await click('[data-fixed-open="diy"]');
  assert.equal(await evaluate('document.getElementById("danmakuCustomKeywordInput").value'), '未添加的关键词草稿');
  await click('[data-fixed-open="welcome"]');
  await click('[data-welcome-library="messages"]');
  await click('#danmakuWelcomeNextPage');
  await input('danmakuWelcomeInput', '未添加的欢迎草稿');
  await click('[data-fixed-open="random"]');
  await click('[data-fixed-open="welcome"]');
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
  assert.equal(await evaluate('window.fixtureToasts.length'), 1);
  assert.equal(await evaluate('window.fixtureToasts[0].message'), '昵称生僻字自动注音已开启');
  await wait(`Array.from(document.querySelectorAll('#toast .toast')).some(node =>
    !node.hidden && node.getBoundingClientRect().height > 0 && getComputedStyle(node).opacity === '1'
    && node.textContent.includes('昵称生僻字自动注音已开启'))`);
  await capture('pinyin-toast');
  failWrite = true;
  await click('#danmakuWelcomePinyinToggle');
  await wait('window.fixtureToasts.length === 2');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomePinyinToggle").checked'), true);
  assert.equal(await evaluate('window.fixtureToasts[1].options.type'), 'error');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeOverviewStatus").textContent'), overviewText);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeServerStatus").hidden'), true);
  await wait(`Array.from(document.querySelectorAll('#toast .toast-error')).some(node =>
    !node.hidden && node.getBoundingClientRect().height > 0 && getComputedStyle(node).opacity === '1'
    && node.textContent.includes('昵称生僻字自动注音关闭尚未确认'))`);
  await capture('pinyin-error');
  await click('#danmakuWelcomeToggle');
  await wait('window.fixtureToasts.length === 3');
  assert.match(await evaluate('window.fixtureToasts[2].message'), /关闭尚未确认/);
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeToggle").checked'), true);
  await capture('unconfirmed');
  legacy = true;
  failWrite = false;
  await win.reload();
  await wait('window.fixtureReady && !document.getElementById("danmakuWelcomeToggle").disabled');
  await click('[data-fixed-open="welcome"]');
  assert.equal(await evaluate('document.getElementById("danmakuWelcomeCapability").hidden'), false);
  await capture('legacy');
  console.log(
    JSON.stringify({
      ok: true,
      collapsed,
      expanded,
      screenshots: output,
      checks:
        'real Electron/IPC, one retained editor, keyboard and disabled state, local and server drafts, pagination counts, responsive widths, 200% zoom, invalid input, independent pinyin toggle, single success/error toast, unconfirmed close, legacy capability',
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
