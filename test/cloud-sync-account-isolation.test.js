'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudSyncController } = require('../src/electron/cloud-sync-controller');

function createFixture(t, initialAccount = 'first') {
  let account = initialAccount;
  let state = 'authorized';
  let listener;
  let cookie = 'unowned-local-cookie';
  const calls = [];
  const cloud = new Map([
    ['first', { revision: 9, cookie: 'first-cloud-cookie' }],
    ['second', { revision: 1, cookie: 'second-cloud-cookie' }],
  ]);
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => state,
    getSnapshot: () => ({ streamer: { accountName: account } }),
    getRemoteBaseUrl: () => 'https://api.example.test',
    onStateChanged(callback) { listener = callback; return () => { listener = null; }; },
    async getCloudState() {
      const current = cloud.get(account);
      return {
        settings: { initialized: true, revision: 1, values: { giftBlindBoxConfig: [] } },
        songs: { initialized: true, revision: 1 },
        bilibili: { initialized: Boolean(current), revision: current?.revision || 0 },
      };
    },
    getCloudSongs: async () => ({ songs: [], revision: 1 }),
    async getBilibiliCredentialsInternal() {
      return { ...cloud.get(account), loggedIn: Boolean(cloud.get(account)?.cookie) };
    },
    async setBilibiliCredentialsInternal(value) {
      calls.push(['upload', account, value]);
      if (account === 'first') throw new Error('NETWORK_UNAVAILABLE');
      return { revision: 2, loggedIn: true };
    },
    async clearBilibiliCredentialsInternal() {
      calls.push(['clear-cloud', account]);
      const revision = (cloud.get(account)?.revision || 0) + 1;
      cloud.set(account, { cookie: '', revision });
      return { revision, loggedIn: false };
    },
  };
  const controller = createCloudSyncController({
    licenseManager,
    runtime: { applyCloudSettingsSnapshot() {}, replaceCloudSongsSnapshot() {} },
    bilibiliAuth: {
      getAuthState: async () => ({ loggedIn: Boolean(cookie) }),
      getCookieHeader: async () => cookie,
      async replaceCookieHeader(value) { cookie = value; calls.push(['apply', value]); },
      async logout() { cookie = ''; calls.push(['clear-local']); },
    },
    timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
  });
  t.after(() => controller.dispose());
  return {
    controller, licenseManager, calls, cloud,
    getCookie: () => cookie,
    setCookie: (value) => { cookie = value; },
    setAccount(value) { account = value; state = 'authorized'; listener?.({ state }); },
    setState(value) { state = value; listener?.({ state }); },
  };
}

test('account switch discards old dirty credentials and resets revision baselines', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  fixture.setCookie('first-pending-cookie');
  fixture.controller.markDirty('bilibili');
  await fixture.controller.whenIdle();
  assert.equal(fixture.calls.filter(([type]) => type === 'upload').length, 1);

  fixture.setAccount('second');
  await fixture.controller.whenIdle();
  assert.equal(fixture.getCookie(), 'second-cloud-cookie');
  assert.equal(fixture.calls.filter(([type]) => type === 'upload').length, 1);
  fixture.setAccount('first');
  await fixture.controller.whenIdle();
  assert.equal(fixture.getCookie(), 'first-cloud-cookie');
  assert.equal(fixture.cloud.get('second').cookie, 'second-cloud-cookie');
});

test('late credentials from the previous account cannot reach the new account', async (t) => {
  const fixture = createFixture(t);
  let release;
  let entered;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const original = fixture.licenseManager.getBilibiliCredentialsInternal;
  fixture.licenseManager.getBilibiliCredentialsInternal = async () => {
    fixture.licenseManager.getBilibiliCredentialsInternal = original;
    entered();
    return pending;
  };
  const firstSync = fixture.controller.start();
  await started;
  fixture.setAccount('second');
  release({ loggedIn: true, cookie: 'late-first-cookie', revision: 99 });
  await firstSync;
  await fixture.controller.whenIdle();
  assert.equal(fixture.getCookie(), 'second-cloud-cookie');
  assert.equal(fixture.calls.some((entry) => entry.includes('late-first-cookie')), false);
});

test('an empty new account never inherits an unowned local login', async (t) => {
  const fixture = createFixture(t, 'new-account');
  await fixture.controller.start();
  assert.equal(fixture.getCookie(), '');
  assert.deepEqual(fixture.calls, [['clear-local']]);
  fixture.setCookie('explicit-new-login');
  fixture.controller.markDirty('bilibili');
  await fixture.controller.whenIdle();
  assert.deepEqual(fixture.calls.at(-1), ['upload', 'new-account', 'explicit-new-login']);
});

test('same-account authorization interruption retains a pending login retry', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  fixture.setCookie('retry-first-cookie');
  fixture.controller.markDirty('bilibili');
  await fixture.controller.whenIdle();
  fixture.setState('blocked');
  fixture.setState('authorized');
  await fixture.controller.whenIdle();
  assert.deepEqual(fixture.calls.filter(([type]) => type === 'upload'), [
    ['upload', 'first', 'retry-first-cookie'], ['upload', 'first', 'retry-first-cookie'],
  ]);
});

test('independent desktop controllers keep account cookies and queues separate', async (t) => {
  const first = createFixture(t, 'first');
  const second = createFixture(t, 'second');
  await Promise.all([first.controller.start(), second.controller.start()]);
  first.setCookie('first-local');
  second.setCookie('second-local');
  first.controller.markDirty('bilibili');
  second.controller.markDirty('bilibili');
  await Promise.all([first.controller.whenIdle(), second.controller.whenIdle()]);
  assert.deepEqual(first.calls.filter(([type]) => type === 'upload'), [['upload', 'first', 'first-local']]);
  assert.deepEqual(second.calls.filter(([type]) => type === 'upload'), [['upload', 'second', 'second-local']]);
});

test('local logout completed during same-account authorization loss is retried', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  fixture.setState('blocked');
  fixture.setCookie('');
  fixture.controller.markDirty('bilibili');
  fixture.setState('authorized');
  await fixture.controller.whenIdle();
  assert.equal(fixture.getCookie(), '');
  assert.deepEqual(fixture.calls.filter(([type]) => type === 'clear-cloud'), [['clear-cloud', 'first']]);
});

test('local login completed during same-account authorization loss is retried', async (t) => {
  const fixture = createFixture(t);
  await fixture.controller.start();
  fixture.setState('blocked');
  fixture.setCookie('first-new-login');
  fixture.controller.markDirty('bilibili');
  fixture.setState('authorized');
  await fixture.controller.whenIdle();
  assert.deepEqual(fixture.calls.filter(([type]) => type === 'upload'), [['upload', 'first', 'first-new-login']]);
});
