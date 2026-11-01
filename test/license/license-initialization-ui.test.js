'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT = fs.readFileSync(path.join(__dirname, '../..', 'public', 'js', 'license.js'), 'utf8');
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

test('a revoked saved device waits for the user before any authorization call', async () => {
  const snapshot = { state: 'blocked', error: 'DEVICE_REVOKED' };
  const page = await createPage({ licenseSnapshot: snapshot });
  assert.equal(page.get('licenseSubmitBtn').disabled, false);
  assert.deepEqual(page.calls, []);
});

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

test('temporary server failures keep retry available', async () => {
  const page = await createPage({ licenseSnapshot: { state: 'needs_connection', error: 'HTTP_503' } });
  assert.equal(page.get('licenseRetryBtn').hidden, false);
});

for (const action of ['activate', 'retry']) {
  test(`a rejected ${action} restores both license actions and permits another attempt`, async () => {
    const attempt = Promise.withResolvers();
    const page = await createPage({
      licenseSnapshot: { state: 'needs_connection', error: 'NETWORK_UNAVAILABLE' },
      authorizationResult: attempt.promise,
    });
    page.get('licenseAccountName').value = 'test-account';
    page.get('licensePassword').value = 'Test-password-123';
    page.get('licenseActivationCode').value = 'TEST-CODE';
    const invoke = () => action === 'activate' ? page.submit() : page.click('licenseRetryBtn');
    const pending = invoke();
    assert.equal(page.get('licenseSubmitBtn').disabled, true);
    assert.equal(page.get('licenseRetryBtn').disabled, true);
    await invoke();
    assert.equal(page.calls.length, 1, 'pending attempts are not duplicated');
    attempt.reject(new Error('synthetic connection failure'));
    await pending;
    assert.equal(page.get('licenseSubmitBtn').disabled, false);
    assert.equal(page.get('licenseRetryBtn').disabled, false);
    await invoke();
    assert.equal(page.calls.length, 2);
    assert.equal(page.get('licenseSubmitBtn').disabled, false);
    assert.equal(page.get('licenseRetryBtn').disabled, false);
  });
}

test('returning from failed preparation clears entered secrets without new calls', async () => {
  const page = await createPage();
  assert.equal(page.get('giftCatalogInitializationCard').hidden, false);
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, false);

  page.get('licensePassword').value = 'old-password';
  page.get('licenseActivationCode').value = 'old-code';
  page.click('giftCatalogInitializationBackBtn');
  assert.equal(page.get('giftCatalogInitializationCard').hidden, true);
  assert.equal(page.get('licenseLoginCard').hidden, false);
  assert.equal(page.get('licensePassword').value, '');
  assert.equal(page.get('licenseActivationCode').value, '');
  assert.equal(page.get('licenseRetryBtn').hidden, false);
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
  assert.equal(page.get('giftCatalogInitializationBackBtn').hidden, true);
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
});
