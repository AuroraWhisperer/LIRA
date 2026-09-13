'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  LicenseState,
} = require('../src/electron/license/license-runtime-policy');
const {
  createDesktopReadinessController,
} = require('../src/electron/desktop-readiness-controller');

function createHarness({ ready = true, authorized = true } = {}) {
  const cloud = Promise.withResolvers();
  const calls = [];
  const navigations = [];
  const licenseListeners = new Set();
  const catalogListeners = new Set();
  let state = authorized
    ? LicenseState.AUTHORIZED
    : LicenseState.NEEDS_ACTIVATION;
  let epoch = 1;
  let lastLicenseListener;
  let lastCatalogListener;
  const controller = createDesktopReadinessController({
    baseUrl: 'http://127.0.0.1:3000',
    writeLog: (...args) => calls.push(['log', ...args]),
    getMainWindow: () => ({
      isDestroyed: () => false,
      loadURL(url) {
        const task = Promise.withResolvers();
        navigations.push({ url, ...task });
        return task.promise;
      },
    }),
    licenseManager: {
      getState: () => state,
      getAuthorizationEpoch: () => epoch,
      onStateChanged(listener) {
        lastLicenseListener = listener;
        licenseListeners.add(listener);
        return () => licenseListeners.delete(listener);
      },
    },
    runtime: {
      isGiftCatalogInitialized: () => ready,
      initializeGiftCatalog: (request) => {
        calls.push(['catalog', request.reason]);
        return Promise.resolve();
      },
      resumeAuthorizedWork: () => calls.push(['resume']),
      pauseAuthorizedWork: () => calls.push(['pause']),
      onGiftCatalogInitializationStateChanged(listener) {
        lastCatalogListener = listener;
        catalogListeners.add(listener);
        return () => catalogListeners.delete(listener);
      },
    },
    remoteGiftController: {
      start: () => calls.push(['gifts:start']),
      stop: () => calls.push(['gifts:stop']),
    },
    cloudSyncController: {
      start: () => {
        calls.push(['cloud:start']);
        return cloud.promise;
      },
      whenIdle: () => {
        calls.push(['cloud:idle']);
        return cloud.promise;
      },
    },
  });
  return {
    controller,
    cloud,
    calls,
    navigations,
    licenseListeners,
    catalogListeners,
    change(next) {
      state = next;
      epoch++;
      for (const listener of licenseListeners) listener({ state });
    },
    ready() {
      ready = true;
      for (const listener of catalogListeners) listener({ status: 'ready' });
    },
    lateCallbacks() {
      lastLicenseListener({ state: LicenseState.AUTHORIZED });
      lastCatalogListener({ status: 'ready' });
    },
  };
}

test('startup freezes gift source before cloud restore and resumes only after restore', async () => {
  const h = createHarness();
  assert.equal(h.controller.initialRoute, 'admin');
  h.controller.start();
  h.controller.start();
  assert.deepEqual(h.calls, [
    ['gifts:start'],
    ['cloud:start'],
    ['catalog', 'authorized-startup'],
  ]);
  h.cloud.resolve();
  await h.cloud.promise;
  await Promise.resolve();
  assert.equal(h.calls.filter(([call]) => call === 'resume').length, 1);
  h.controller.dispose();
});

for (const action of ['revoke', 'dispose', 'rotate']) {
  test(`${action} invalidates a pending authorized recovery`, async () => {
    const h = createHarness();
    h.controller.start();
    if (action === 'dispose') h.controller.dispose();
    else
      h.change(
        action === 'revoke' ? LicenseState.BLOCKED : LicenseState.AUTHORIZED,
      );
    h.cloud.resolve();
    await h.cloud.promise;
    await Promise.resolve();
    assert.equal(
      h.calls.filter(([call]) => call === 'resume').length,
      action === 'rotate' ? 1 : 0,
    );
    if (action === 'revoke') {
      assert.ok(h.calls.some(([call]) => call === 'gifts:stop'));
      assert.ok(h.calls.some(([call]) => call === 'pause'));
    }
    h.controller.dispose();
  });
}

test('catalog readiness gates navigation and stale load rejection cannot reset the newer route', async () => {
  const h = createHarness({ ready: false });
  assert.equal(h.controller.initialRoute, 'license');
  h.controller.start();
  assert.ok(h.calls.some((call) => call[1] === 'first-authorized-startup'));
  h.ready();
  h.change(LicenseState.BLOCKED);
  h.navigations[0].reject(new Error('old navigation'));
  await Promise.resolve();
  h.change(LicenseState.BLOCKED);
  assert.deepEqual(
    h.navigations.map((navigation) => navigation.url),
    ['http://127.0.0.1:3000/admin?desktop=1', 'http://127.0.0.1:3000/license'],
  );
  h.ready();
  assert.equal(h.navigations.length, 2);
  h.controller.dispose();
});

test('dispose removes both listeners and rejects queued callbacks and repeated start', () => {
  const h = createHarness({ authorized: false });
  h.controller.start();
  h.controller.dispose();
  h.controller.dispose();
  const before = h.calls.length;
  h.lateCallbacks();
  h.controller.start();
  assert.equal(h.licenseListeners.size, 0);
  assert.equal(h.catalogListeners.size, 0);
  assert.equal(h.calls.length, before);
  assert.equal(h.navigations.length, 0);
});
