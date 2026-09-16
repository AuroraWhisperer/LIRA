'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { readAdminHtml } = require('./helpers/admin-html');

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(api) {
  const elements = new Map();
  function element() {
    const listeners = new Map();
    return {
      textContent: '',
      disabled: false,
      hidden: true,
      setAttribute() {},
      replaceChildren() {},
      reset() {},
      addEventListener: (event, callback) => listeners.set(event, callback),
      removeEventListener: (event) => listeners.delete(event),
      click: () => listeners.get('click')?.(),
    };
  }
  const root = {
    setAttribute() {},
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
  };
  let licenseListener = null;
  const license = {
    onStateChanged: (listener) => {
      licenseListener = listener;
      return () => {
        licenseListener = null;
      };
    },
  };
  const { initDynamicLottery } = await loadModuleExports(
    path.resolve(__dirname, '../public/js/admin/dynamic-lottery.js'),
    {
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: async () => ({
        ok: true,
        text: async () => JSON.stringify({
          ok: true,
          data: { tasks: [], task: null, result: null, job: null, error: '' },
        }),
      }),
    },
  );
  const controller = initDynamicLottery({ root, api, license });
  await settle();
  return {
    controller,
    elements,
    get: (name) => elements.get(`[data-lottery-${name}]`),
    changeLicense: () => licenseListener?.(),
  };
}

test('toolbox contains the separate account entry and drawing controls with source limitations', () => {
  const html = readAdminHtml();
  assert.match(html, /data-other-feature="otherDynamicLotteryFeature"/);
  assert.match(html, /aria-labelledby="otherDynamicLotteryFeatureTab"/);
  assert.match(html, /独立登录，不影响直播账号/);
  assert.match(html, /data-lottery-create/);
  assert.match(html, /data-lottery-draw/);
  assert.match(html, /暂不支持可靠核验视频点赞和分享名单/);
});

test('browser fallback is explicit and never uses live-account login', async () => {
  const f = await fixture(undefined);
  assert.equal(f.get('login').disabled, true);
  assert.match(f.get('auth-message').textContent, /桌面版/);
  f.controller.dispose();
});

test('login is single-flight and updates account state; logout affects only the dedicated bridge', async () => {
  const pending = Promise.withResolvers();
  let calls = 0;
  const api = {
    getState: async () => ({ ok: true, state: { loggedIn: false, uid: '' } }),
    login: () => {
      calls += 1;
      return pending.promise;
    },
    logout: async () => ({ ok: true, state: { loggedIn: false, uid: '' } }),
  };
  const f = await fixture(api);
  const first = f.get('login').click();
  f.get('login').click();
  assert.equal(calls, 1);
  assert.equal(f.get('login').disabled, true);
  pending.resolve({
    ok: true,
    state: { loggedIn: true, uid: '9007199254740993123' },
  });
  await first;
  assert.match(f.get('auth-status').textContent, /9007199254740993123/);
  assert.equal(f.get('logout').disabled, false);
  assert.equal(f.get('login').hidden, true);
  f.get('account-toggle').click();
  assert.equal(f.get('account-panel').hidden, false);
  await f.get('logout').click();
  assert.match(f.get('auth-message').textContent, /直播账号不受影响/);
  assert.equal(f.get('login').hidden, false);
  f.controller.dispose();
});

test('authorization changes discard a late login result and refresh the new account', async () => {
  const pending = Promise.withResolvers();
  const f = await fixture({
    getState: async () => ({ ok: true, state: { loggedIn: false, uid: '' } }),
    login: () => pending.promise,
    logout: async () => {},
  });
  const login = f.get('login').click();
  f.changeLicense();
  await settle();
  pending.resolve({ ok: true, state: { loggedIn: true, uid: '123' } });
  await login;
  assert.equal(f.get('auth-status').textContent, '未登录抽奖账号');
  f.controller.dispose();
});

test('cancellation and safe error codes provide an actionable message without raw errors', async () => {
  const f = await fixture({
    getState: async () => ({ ok: true, state: { loggedIn: false, uid: '' } }),
    login: async () => ({
      ok: false,
      error: 'LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE',
      raw: 'secret',
    }),
    logout: async () => {},
  });
  await f.get('login').click();
  assert.match(f.get('auth-message').textContent, /加密存储/);
  assert.doesNotMatch(f.get('auth-message').textContent, /secret/);
  f.controller.dispose();
});
