'use strict';

const { readAdminFragmentHtml, readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const browserFixture = createUiFixture();

async function createDanmakuPage(t, state = {}, html = readAdminFragmentHtml('pages/admin/toolbox/danmaku.html')) {
  const page = await browserFixture(t, 'danmaku');
  await page.evaluate(
    async ({ html, state, overlayHtml }) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      document.body.append(parsed.getElementById('otherAssistantPage') || parsed.getElementById('otherDanmakuFeature'));
      const overlay = new DOMParser().parseFromString(overlayHtml, 'text/html').getElementById('liveDanmakuFeature');
      document.body.append(overlay);
      for (const id of [
        'bilibiliAuthStatus',
        'bilibiliAuthProfile',
        'bilibiliAuthAvatar',
        'bilibiliAuthName',
        'bilibiliAuthUid',
        'bilibiliLoginBtn',
        'bilibiliLogoutBtn',
      ]) {
        const node = parsed.getElementById(id);
        if (node) document.body.append(node);
      }
      document.getElementById('otherDanmakuFeature').hidden = false;
      window.danmakuState = {
        loggedIn: true,
        accountUid: 123,
        accountName: '测试账号',
        roomId: 456,
        roomName: '测试直播间',
        canSend: true,
        connected: true,
        ...state,
      };
      window.danmakuRequests = [];
      window.reconnects = 0;
      window.AdminApp = {
        utils: { toast() {} },
        settings: {
          async reconnectBilibili() {
            window.reconnects++;
            window.danmakuState.connected = true;
          },
        },
      };
      window.fetch = async (url) => {
        if (url !== '/api/bilibili/danmaku/state') throw new Error(`Unexpected danmaku request: ${url}`);
        window.danmakuRequests.push(url);
        return {
          ok: true,
          json: async () => ({ ok: true, data: window.danmakuState }),
        };
      };
      await import('/js/admin/danmaku-tool.js');
      window.AdminApp.danmakuTool.init({
        reconnectBilibili: window.AdminApp.settings.reconnectBilibili,
        toast() {},
      });
      await window.AdminApp.danmakuTool.refresh();
    },
    { html, state, overlayHtml: readAdminFragmentHtml('pages/admin/live-components/danmaku.html') },
  );
  return page;
}

test('danmaku character counter counts Chinese and emoji as code points', async (t) => {
  const page = await createDanmakuPage(t);
  await page.locator('#danmakuMessage').fill('中文🙂');
  assert.equal(await page.locator('#danmakuCounter').textContent(), '3 字');
});

test('danmaku compose buttons stay beside the first line while the input grows and shrinks', async (t) => {
  const page = await createDanmakuPage(t);
  for (const file of ['styles-base.css', 'admin/toolbox/danmaku-tool.css']) {
    await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../../public/css', file), 'utf8') });
  }
  const input = page.locator('#danmakuMessage');
  const autoButton = page.locator('#danmakuAutoBtn');
  const sendButton = page.locator('#danmakuSendBtn');
  const initial = await input.boundingBox();
  const auto = await autoButton.boundingBox();
  const send = await sendButton.boundingBox();
  assert.equal(auto.y, initial.y);
  assert.equal(send.y, initial.y);
  assert.ok(auto.x >= initial.x + initial.width);
  assert.ok(send.x >= auto.x + auto.width);
  assert.ok(Math.abs(auto.height - initial.height) < 1);
  assert.ok(Math.abs(send.height - initial.height) < 1);
  await input.fill(Array(20).fill('中文🙂输入内容').join('\n'));
  const expanded = await input.boundingBox();
  assert.ok(expanded.height > 160, 'long input grows beyond the former height cap');
  assert.equal((await sendButton.boundingBox()).height, send.height);
  assert.equal((await sendButton.boundingBox()).y, expanded.y);
  const counter = await page.locator('#danmakuCounter').boundingBox();
  assert.ok(counter.y - expanded.y - expanded.height <= 4);
  assert.equal(await input.inputValue(), Array(20).fill('中文🙂输入内容').join('\n'));
  await input.fill('');
  assert.equal((await input.boundingBox()).height, initial.height);
});

test('sending a danmaku clears only the submitted draft and preserves edits made while sending', async (t) => {
  const page = await createDanmakuPage(t);
  await page.evaluate(() => {
    const read = window.fetch;
    window.fetch = (url) => url === '/api/bilibili/danmaku/send'
      ? new Promise(resolve => { window.finishSend = () => resolve({ ok: true, json: async () => ({ ok: true, data: {} }) }); })
      : read(url);
  });
  for (const edit of [false, true]) {
    await page.locator('#danmakuMessage').fill('第一条');
    await page.locator('#danmakuSendBtn').click();
    if (edit) await page.locator('#danmakuMessage').fill('下一条🙂');
    await page.evaluate(() => window.finishSend());
    await page.waitForFunction(() => !document.getElementById('danmakuSendBtn').disabled);
    assert.equal(await page.locator('#danmakuMessage').inputValue(), edit ? '下一条🙂' : '');
    assert.equal(await page.locator('#danmakuCounter').textContent(), edit ? '4 字' : '0 字');
  }
});

for (const scenario of [
  {
    name: 'display names',
    state: {},
    account: '测试账号',
    room: '测试直播间',
    accountTitle: 'UID 123',
    roomTitle: '房间 456',
  },
  {
    name: 'identity fallbacks',
    state: { accountName: '', roomName: '' },
    account: 'UID 123',
    room: '房间 456',
    accountTitle: 'UID 123',
    roomTitle: '房间 456',
  },
  {
    name: 'missing login and room',
    state: { loggedIn: false, roomId: null },
    account: '未登录',
    room: '未设置',
    accountTitle: '',
    roomTitle: '',
  },
]) {
  test(`danmaku status renders ${scenario.name}`, async (t) => {
    const page = await createDanmakuPage(t, scenario.state);
    assert.equal(await page.locator('#danmakuAccountState').textContent(), scenario.account);
    assert.equal(await page.locator('#danmakuRoomState').textContent(), scenario.room);
    assert.equal(await page.locator('#danmakuAccountState').getAttribute('title'), scenario.accountTitle);
    assert.equal(await page.locator('#danmakuRoomState').getAttribute('title'), scenario.roomTitle);
  });
}

test('successful Bilibili login refreshes danmaku once and enables sending', async (t) => {
  const html = readAdminFragmentHtml('pages/admin/toolbox/danmaku.html') +
    readAdminFragmentHtml('pages/admin/song/settings.html');
  const page = await createDanmakuPage(t, { loggedIn: false, canSend: false }, html);
  assert.equal(await page.locator('#danmakuSendBtn').isEnabled(), false);
  await page.evaluate(async () => {
    const { initBilibiliAuth } = await import('/js/admin/settings-auth.js');
    window.bilibiliAuth = {
      getAuthState: async () => ({
        loggedIn: window.danmakuState.loggedIn,
        uid: 123,
      }),
      async login() {
        Object.assign(window.danmakuState, { loggedIn: true, canSend: true });
        return { state: { loggedIn: true } };
      },
    };
    initBilibiliAuth({
      documentRef: document,
      windowRef: window,
      toast() {},
      logoutConfirm: async () => false,
    });
  });
  await page.locator('#bilibiliLoginBtn').click();
  await page.waitForFunction(() => !document.getElementById('danmakuSendBtn').disabled, null, { timeout: 2000 });
  assert.equal(await page.locator('#danmakuAccountState').textContent(), '测试账号');
  assert.equal(await page.evaluate(() => window.danmakuRequests.length), 2);
});

test('opening a disconnected danmaku panel reconnects once and renders the refreshed state', async (t) => {
  const page = await createDanmakuPage(t, { connected: false }, readAdminHtml());
  assert.equal(await page.locator('#danmakuToolStatus').textContent(), '可发送，监听未连接');
  assert.equal(await page.locator('#danmakuToolStatus').getAttribute('class'), 'connection-bad');
  await page.evaluate(async () => {
    window.localStorage.setItem('admin.toolboxSelectedFeature', 'otherPerformanceFeature');
    await import('/js/admin/toolbox-navigation.js');
    window.AdminApp.other.initOtherPage();
    window.AdminApp.other.selectFeatureById('otherDanmakuFeature');
  });
  await page.waitForFunction(() => document.getElementById('danmakuToolStatus').className === 'connection-good', null, {
    timeout: 2000,
  });
  assert.equal(await page.locator('#danmakuToolStatus').textContent(), '可发送，监听已连接');
  assert.equal(await page.evaluate(() => window.reconnects), 1);
  assert.equal(await page.evaluate(() => window.danmakuRequests.length), 3);
  await page.evaluate(() => window.AdminApp.other.selectFeatureById('otherDanmakuFeature'));
  await page.waitForFunction(() => window.danmakuRequests.length === 4, null, {
    timeout: 2000,
  });
  assert.equal(await page.evaluate(() => window.reconnects), 1);
});
