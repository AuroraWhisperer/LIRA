'use strict';

const { readAdminFragmentHtml, readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
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
      window.reconnectBilibili = async (options) => {
        window.reconnects++;
        window.reconnectOptions = options;
        window.danmakuState.connected = true;
      };
      window.fetch = async (url) => {
        if (url !== '/api/bilibili/danmaku/state') throw new Error(`Unexpected danmaku request: ${url}`);
        window.danmakuRequests.push(url);
        return {
          ok: true,
          json: async () => ({ ok: true, data: structuredClone(window.danmakuState) }),
        };
      };
      window.danmakuTool = (await import('/js/admin/danmaku-tool.js')).danmakuTool;
      window.danmakuTool.init({
        reconnectBilibili: window.reconnectBilibili,
        toast() {},
      });
      await window.danmakuTool.refresh();
    },
    { html, state, overlayHtml: readAdminFragmentHtml('pages/admin/live-components/danmaku.html') },
  );
  return page;
}

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
  await page.locator('#danmakuAutoBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuAutoBtn').textContent === '自动钓鱼/打劫（15 条）');
  await page.clock.runFor(10000);
  assert.deepEqual(await page.evaluate(() => window.autoMessages), ['钓鱼']);
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
    await window.danmakuTool.refresh({ reconnectIfDisconnected: true });
  });
  assert.equal(await page.evaluate(() => window.reconnects), 0);
  await page.evaluate(async () => {
    document.getElementById('danmakuMonitoringEnabled').checked = true;
    window.danmakuState.roomId = '';
    await window.danmakuTool.refresh({ reconnectIfDisconnected: true });
  });
  assert.equal(await page.evaluate(() => window.reconnects), 0);
});

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
  assert.equal(await page.evaluate(() => window.danmakuRequests.length), 2);
});

test('opening a disconnected danmaku panel reconnects once and refreshes the state', async (t) => {
  const page = await createDanmakuPage(t, { connected: false }, readAdminHtml());
  await page.evaluate(async () => {
    window.localStorage.setItem('admin.toolboxSelectedFeature', 'otherPerformanceFeature');
    window.other = (await import('/js/admin/toolbox-navigation.js')).other;
    window.other.initOtherPage({ danmakuTool: window.danmakuTool, reconnectBilibili: window.reconnectBilibili });
    window.other.selectFeatureById('otherDanmakuFeature');
  });
  await page.waitForFunction(() => document.getElementById('danmakuToolStatus').className === 'connection-good', null, {
    timeout: 2000,
  });
  assert.equal(await page.evaluate(() => window.reconnects), 1);
  assert.deepEqual(await page.evaluate(() => window.reconnectOptions), { silent: true });
  assert.equal(await page.evaluate(() => window.danmakuRequests.length), 3);
  await page.evaluate(() => window.other.selectFeatureById('otherDanmakuFeature'));
  await page.waitForFunction(() => window.danmakuRequests.length === 4, null, {
    timeout: 2000,
  });
  assert.equal(await page.evaluate(() => window.reconnects), 1);
});
