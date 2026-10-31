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
        sendSession: 'synthetic-session',
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
          async reconnectBilibili(options) {
            window.reconnects++;
            window.reconnectOptions = options;
            window.danmakuState.connected = true;
          },
        },
      };
      window.fetch = async (url) => {
        if (url !== '/api/bilibili/danmaku/state') throw new Error(`Unexpected danmaku request: ${url}`);
        window.danmakuRequests.push(url);
        return {
          ok: true,
          json: async () => ({ ok: true, data: structuredClone(window.danmakuState) }),
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

test('automatic sending stops during the five-second wait and sends no remaining messages', async (t) => {
  const page = await createDanmakuPage(t);
  await page.clock.install();
  await page.evaluate(() => {
    const read = window.fetch;
    window.autoMessages = [];
    window.fetch = async (url, options) => {
      if (url !== '/api/bilibili/danmaku/send') return read(url);
      window.autoMessages.push(JSON.parse(options.body).message);
      return { ok: true, json: async () => ({ ok: true, data: {} }) };
    };
  });
  await page.locator('#danmakuAutoBtn').click();
  await page.waitForFunction(() => window.autoMessages.length === 1);
  assert.equal(await page.locator('#danmakuAutoBtn').textContent(), '停止自动发送');
  await page.locator('#danmakuAutoBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuAutoBtn').textContent === '自动钓鱼/打劫（15 条）');
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => window.autoMessages), ['钓鱼']);
  assert.match(await page.locator('#danmakuSendResult').textContent(), /已停止后续/);
});

for (const change of ['account', 'room', 'unannounced-room']) {
  test(`automatic sending stops when its ${change} context changes`, async t => {
    const page = await createDanmakuPage(t);
    await page.clock.install();
    await page.evaluate(() => {
      const read = window.fetch;
      window.autoMessages = [];
      window.fetch = async (url, options) => {
        if (url !== '/api/bilibili/danmaku/send') return read(url);
        const body = JSON.parse(options.body);
        if (body.sendSession !== window.danmakuState.sendSession) {
          return { ok: false, json: async () => ({ ok: false, error: '直播账号或房间已变更，已停止剩余自动发送。' }) };
        }
        window.autoMessages.push(body);
        return { ok: true, json: async () => ({ ok: true, data: {} }) };
      };
    });
    await page.locator('#danmakuAutoBtn').click();
    await page.waitForFunction(() => window.autoMessages.length === 1);
    await page.evaluate(change => {
      window.danmakuState.sendSession = 'changed-session';
      if (change === 'account') {
        window.danmakuState.accountUid = 999;
        document.dispatchEvent(new CustomEvent('app:bilibili-auth-changed'));
      } else {
        window.danmakuState.roomId = 999;
        if (change === 'room') window.dispatchEvent(new CustomEvent('app:settings-state', { detail: { roomId: '999' } }));
      }
    }, change);
    await page.clock.runFor(10000);
    await page.waitForFunction(() => document.getElementById('danmakuAutoBtn').textContent === '自动钓鱼/打劫（15 条）');
    assert.deepEqual(await page.evaluate(() => window.autoMessages), [{ message: '钓鱼', sendSession: 'synthetic-session' }]);
    assert.match(await page.locator('#danmakuSendResult').textContent(), /已变更.*已停止/);
  });
}

test('automatic sending completes its fifteen messages with the original session assertion', async t => {
  const page = await createDanmakuPage(t);
  await page.clock.install();
  await page.evaluate(() => {
    const read = window.fetch;
    window.autoMessages = [];
    window.fetch = async (url, options) => {
      if (url !== '/api/bilibili/danmaku/send') return read(url);
      window.autoMessages.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, data: {} }) };
    };
  });
  await page.locator('#danmakuAutoBtn').click();
  await page.waitForFunction(() => window.autoMessages.length === 1);
  await page.clock.runFor(70000);
  await page.waitForFunction(() => document.getElementById('danmakuSendResult').textContent.includes('自动发送完成'));
  const messages = await page.evaluate(() => window.autoMessages);
  assert.deepEqual(messages.map(message => message.message), [...Array(10).fill('钓鱼'), ...Array(5).fill('打劫')]);
  assert.ok(messages.every(message => message.sendSession === 'synthetic-session'));
});

test('automatic refresh stays quiet and skips disabled monitoring or an unset room', async (t) => {
  const page = await createDanmakuPage(t, { connected: false });
  await page.evaluate(async () => {
    document.getElementById('danmakuMonitoringEnabled').checked = false;
    await window.AdminApp.danmakuTool.refresh({ reconnectIfDisconnected: true });
  });
  assert.equal(await page.evaluate(() => window.reconnects), 0);
  await page.evaluate(async () => {
    document.getElementById('danmakuMonitoringEnabled').checked = true;
    window.danmakuState.roomId = '';
    await window.AdminApp.danmakuTool.refresh({ reconnectIfDisconnected: true });
  });
  assert.equal(await page.evaluate(() => window.reconnects), 0);
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
  assert.deepEqual(await page.evaluate(() => window.reconnectOptions), { silent: true });
  assert.equal(await page.evaluate(() => window.danmakuRequests.length), 3);
  await page.evaluate(() => window.AdminApp.other.selectFeatureById('otherDanmakuFeature'));
  await page.waitForFunction(() => window.danmakuRequests.length === 4, null, {
    timeout: 2000,
  });
  assert.equal(await page.evaluate(() => window.reconnects), 1);
});

test('degraded live listening is shown as possibly delayed instead of connected', async (t) => {
  const page = await createDanmakuPage(t, { liveMessage: '弹幕长连已断开，历史消息监听中' });
  assert.equal(await page.locator('#danmakuToolStatus').textContent(), '可发送，弹幕可能延迟');
  assert.equal(await page.locator('#danmakuToolStatus').getAttribute('class'), 'warn');
});
