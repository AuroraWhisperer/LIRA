'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'license.js'),
  'utf8',
);
const FAILED = { status: 'error', error: 'NETWORK_UNAVAILABLE', percent: 0 };

async function createPage({
  getCatalog = async () => FAILED,
  retryCatalog,
} = {}) {
  const elements = new Map();
  const calls = [];
  let licenseListener;
  let catalogListener;
  const get = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        hidden: false,
        disabled: false,
        textContent: '',
        listeners: new Map(),
        setAttribute() {},
        addEventListener(type, listener) {
          this.listeners.set(type, listener);
        },
      });
    }
    return elements.get(id);
  };
  vm.runInNewContext(SCRIPT, {
    document: { getElementById: get },
    window: {
      addEventListener() {},
      liraLicense: {
        getState: async () => ({ state: 'authorized' }),
        getGiftCatalogState: getCatalog,
        async activate() {
          calls.push('activate');
        },
        async retry() {
          calls.push('retry-authorization');
          return { state: 'authorized' };
        },
        async retryGiftCatalog() {
          calls.push('retry-catalog');
          return retryCatalog ? retryCatalog() : FAILED;
        },
        onStateChanged(listener) {
          licenseListener = listener;
          return () => {};
        },
        onGiftCatalogStateChanged(listener) {
          catalogListener = listener;
          return () => {};
        },
      },
    },
  });
  await new Promise(setImmediate);
  return {
    get,
    calls,
    click: (id) => get(id).listeners.get('click')?.(),
    licenseChanged: (snapshot) => licenseListener(snapshot),
    catalogChanged: (snapshot) => catalogListener(snapshot),
  };
}

test('failed preparation offers return to login and explains network failures', async () => {
  const page = await createPage();
  assert.equal(page.get('giftCatalogInitializationCard').hidden, false);
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, false);
  assert.match(
    page.get('giftCatalogInitializationStatus').textContent,
    /检查网络/,
  );

  page.get('licensePassword').value = 'old-password';
  page.get('licenseActivationCode').value = 'old-code';
  page.click('giftCatalogInitializationBackBtn');
  assert.equal(page.get('giftCatalogInitializationCard').hidden, true);
  assert.equal(page.get('licenseLoginCard').hidden, false);
  assert.equal(page.get('licensePassword').value, '');
  assert.equal(page.get('licenseActivationCode').value, '');
  assert.equal(page.get('licenseRetryBtn').hidden, false);
  assert.equal(page.get('licenseRetryBtn').textContent, '继续准备');
  assert.deepEqual(page.calls, []);

  page.catalogChanged(FAILED);
  page.licenseChanged({ state: 'authorized' });
  await new Promise(setImmediate);
  assert.equal(page.get('licenseLoginCard').hidden, false);
  assert.equal(page.get('giftCatalogInitializationCard').hidden, true);
});

test('continue preparation reuses authorization and allows returning after another failure', async () => {
  const retry = Promise.withResolvers();
  const page = await createPage({ retryCatalog: () => retry.promise });
  page.click('giftCatalogInitializationBackBtn');
  const continuing = page.click('licenseRetryBtn');
  assert.equal(page.get('licenseLoginCard').hidden, true);
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, true);
  assert.equal(page.get('giftCatalogInitializationRetryBtn').hidden, true);
  await page.click('giftCatalogInitializationRetryBtn');
  assert.deepEqual(page.calls, ['retry-catalog']);

  retry.resolve(FAILED);
  await continuing;
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, false);
  page.click('giftCatalogInitializationBackBtn');
  assert.equal(page.get('licenseLoginCard').hidden, false);
});

test('successful preparation after returning uses the existing ready flow', async () => {
  const page = await createPage({
    retryCatalog: async () => ({ status: 'ready', percent: 100 }),
  });
  page.click('giftCatalogInitializationBackBtn');
  await page.click('licenseRetryBtn');
  assert.deepEqual(page.calls, ['retry-catalog']);
  assert.equal(page.get('giftCatalogInitializationPercent').textContent, '100%');
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, true);
  assert.match(page.get('giftCatalogInitializationHeading').textContent, /准备完成/);
});

test('late catalog results cannot replace login after returning or losing authorization', async () => {
  const catalog = Promise.withResolvers();
  const page = await createPage({ getCatalog: () => catalog.promise });
  page.catalogChanged(FAILED);
  page.click('giftCatalogInitializationBackBtn');
  catalog.resolve(FAILED);
  await new Promise(setImmediate);
  assert.equal(page.get('licenseLoginCard').hidden, false);

  page.licenseChanged({ state: 'blocked', error: 'DEVICE_REVOKED' });
  page.catalogChanged({ status: 'running', percent: 5 });
  assert.equal(page.get('licenseLoginCard').hidden, false);
  assert.equal(page.get('giftCatalogInitializationCard').hidden, true);
  assert.equal(page.get('licenseRetryBtn').textContent, '重试连接');
  assert.match(page.get('licenseStatus').textContent, /授权.*撤销/);
});
