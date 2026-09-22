'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'license.js'), 'utf8');
const FAILED = { status: 'error', error: 'NETWORK_UNAVAILABLE', percent: 0 };

async function createPage({
  getCatalog = async () => FAILED,
  retryCatalog,
  licenseSnapshot = { state: 'authorized' },
  authorizationResult = { state: 'authorized' },
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
        getState: async () => licenseSnapshot,
        getGiftCatalogState: getCatalog,
        async activate() {
          calls.push('activate');
          return authorizationResult;
        },
        async retry() {
          calls.push('retry-authorization');
          return authorizationResult;
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
    submit: () => get('licenseForm').listeners.get('submit')({ preventDefault() {} }),
    licenseChanged: (snapshot) => licenseListener(snapshot),
    catalogChanged: (snapshot) => catalogListener(snapshot),
  };
}

test('a revoked saved device opens with a neutral login notice before any user action', async () => {
  const snapshot = { state: 'blocked', error: 'DEVICE_REVOKED' };
  const page = await createPage({ licenseSnapshot: snapshot });
  assert.equal(page.get('licenseLoginCard').hidden, false);
  assert.equal(page.get('licenseSubmitBtn').disabled, false);
  assert.equal(page.get('licenseStatus').className, 'license-status');
  assert.match(page.get('licenseStatus').textContent, /旧设备授权已撤销/);
  assert.match(page.get('licenseStatus').textContent, /新的短效登录码.*重新登录/);
  assert.deepEqual(page.calls, []);

  page.licenseChanged(snapshot);
  assert.equal(page.get('licenseStatus').className, 'license-status');
});

for (const action of ['login', 'retry']) {
  test(`revocation after an explicit ${action} attempt is an error`, async () => {
    const snapshot = { state: 'blocked', error: 'DEVICE_REVOKED' };
    const page = await createPage({
      licenseSnapshot: snapshot,
      authorizationResult: snapshot,
    });
    if (action === 'login') {
      page.get('licenseAccountName').value = 'test-account';
      page.get('licensePassword').value = 'Test-password-123';
      page.get('licenseActivationCode').value = 'TEST-CODE';
      await page.submit();
    } else {
      await page.click('licenseRetryBtn');
    }

    assert.deepEqual(page.calls, [action === 'login' ? 'activate' : 'retry-authorization']);
    assert.equal(page.get('licenseStatus').className, 'license-status error');
    assert.match(page.get('licenseStatus').textContent, /授权已被管理员撤销/);
    page.licenseChanged(snapshot);
    assert.equal(page.get('licenseStatus').className, 'license-status error');
  });
}

test('startup connection and client-version failures remain visible errors', async () => {
  for (const licenseSnapshot of [
    { state: 'needs_connection', error: 'NETWORK_UNAVAILABLE' },
    { state: 'blocked', error: 'BUILD_NOT_ALLOWED' },
  ]) {
    const page = await createPage({ licenseSnapshot });
    assert.equal(page.get('licenseStatus').className, 'license-status error');
    assert.ok(page.get('licenseStatus').textContent);
  }
});

test('failed preparation offers return to login and explains network failures', async () => {
  const page = await createPage();
  assert.equal(page.get('giftCatalogInitializationCard').hidden, false);
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, false);
  assert.match(page.get('giftCatalogInitializationStatus').textContent, /检查网络/);

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

test('incompatible preparation data explains the server update instead of a network retry', async () => {
  const page = await createPage({
    getCatalog: async () => ({ ...FAILED, error: 'CATALOG_INVALID' }),
  });
  assert.match(page.get('giftCatalogInitializationStatus').textContent, /数据.*不兼容.*管理员.*更新服务端/);
  assert.doesNotMatch(page.get('giftCatalogInitializationStatus').textContent, /检查网络/);
  assert.equal(page.get('giftCatalogInitializationRetryBtn').hidden, false);
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, false);
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
  assert.equal(page.get('licenseStatus').className, 'license-status error');
});
