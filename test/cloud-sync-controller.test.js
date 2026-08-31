'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCloudSyncController,
} = require('../src/electron/cloud-sync-controller');

const LOCAL_BLIND_BOX_CONFIG = [
  {
    name: '本地盲盒',
    price: 10,
    outputs: [{ name: '本地礼物', price: 20 }],
  },
];
const CLOUD_BLIND_BOX_CONFIG = [
  {
    name: '云端盲盒',
    price: 5,
    outputs: [{ name: '云端礼物', price: 8 }],
  },
];

function createFixture(overrides = {}) {
  const calls = [];
  let stateListener = null;
  let localListener = null;
  let timerId = 0;
  let cloudWatch = null;
  const timers = new Map();
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => 'authorized',
    onStateChanged(listener) {
      stateListener = listener;
      return () => {
        stateListener = null;
      };
    },
    getCloudState: async () => ({
      settings: {
        initialized: true,
        revision: 2,
        values: {
          roomId: '123',
          enableBilibili: true,
          paused: false,
          queueLimit: 50,
          userCooldownSeconds: 0,
          onlyFromLibrary: false,
          allowDuplicate: true,
          giftBlindBoxConfig: CLOUD_BLIND_BOX_CONFIG,
        },
      },
      songs: { initialized: true, revision: 3 },
      bilibili: {
        initialized: true,
        revision: 4,
        loggedIn: true,
        uid: '288594073',
      },
    }),
    updateCloudSettings: async (settings) => {
      calls.push(['push-settings', settings]);
      return { initialized: true, revision: 5, values: settings };
    },
    getCloudSongs: async () => ({
      songs: [{ title: 'Cloud song', artist: 'Singer' }],
      initialized: true,
      revision: 3,
    }),
    syncSongs: async (songs) => {
      calls.push(['push-songs', songs]);
      return { initialized: true, revision: 6 };
    },
    getBilibiliCredentialsInternal: async () => ({
      initialized: true,
      revision: 4,
      loggedIn: true,
      uid: '288594073',
      cookie:
        'DedeUserID=288594073; SESSDATA=cloud; bili_jct=cloud-csrf',
    }),
    setBilibiliCredentialsInternal: async (cookie) => {
      calls.push(['push-bilibili', cookie]);
      return { initialized: true, revision: 7, loggedIn: true };
    },
    clearBilibiliCredentialsInternal: async () => {
      calls.push(['clear-bilibili']);
      return { initialized: true, revision: 7, loggedIn: false };
    },
    watchCloudStateChangesInternal: async (options = {}) => {
      cloudWatch = options;
      options.onOpen?.();
      await new Promise((resolve) => {
        if (options.signal?.aborted) return resolve();
        options.signal?.addEventListener('abort', resolve, { once: true });
      });
    },
    ...overrides.licenseManager,
  };
  const runtime = {
    getCloudSettingsSnapshot: () => ({
      roomId: 'local-room',
      enableBilibili: true,
      paused: false,
      queueLimit: 25,
      userCooldownSeconds: 5,
      onlyFromLibrary: false,
      allowDuplicate: true,
      giftBlindBoxConfig: LOCAL_BLIND_BOX_CONFIG,
    }),
    applyCloudSettingsSnapshot: async (settings) =>
      calls.push(['apply-settings', settings]),
    getCloudSongsSnapshot: () => [{ name: 'Local song' }],
    replaceCloudSongsSnapshot: async (songs) =>
      calls.push(['apply-songs', songs]),
    onCloudSyncRequested(listener) {
      localListener = listener;
      return () => {
        localListener = null;
      };
    },
    ...overrides.runtime,
  };
  const bilibiliAuth = {
    getAuthState: async () => ({ loggedIn: false, uid: 0 }),
    getCookieHeader: async () => '',
    replaceCookieHeader: async (cookie) =>
      calls.push(['apply-bilibili', cookie]),
    logout: async () => calls.push(['apply-bilibili-logout']),
    ...overrides.bilibiliAuth,
  };
  const controller = createCloudSyncController({
    licenseManager,
    runtime,
    bilibiliAuth,
    timers: {
      setTimeout(callback, delay) {
        const timer = {
          id: ++timerId,
          callback,
          delay,
          unrefCalled: false,
          unref() {
            this.unrefCalled = true;
          },
        };
        timers.set(timer.id, timer);
        return timer;
      },
      clearTimeout(timer) {
        if (timer) timers.delete(timer.id);
      },
    },
  });
  return {
    calls,
    controller,
    emitLocal: (scope) => localListener?.(scope),
    emitCloud: (event) => cloudWatch?.onChange?.(event),
    emitState: (state) => stateListener?.({ state }),
    timers,
  };
}

test('authorized bootstrap applies initialized cloud settings, songs, and Bilibili credentials', async () => {
  const fixture = createFixture();
  await fixture.controller.start();
  assert.deepEqual(
    fixture.calls.map((call) => call[0]),
    ['apply-settings', 'apply-songs', 'apply-bilibili'],
  );
  const timer = [...fixture.timers.values()][0];
  assert.equal(timer.delay, 600_000);
  assert.equal(timer.unrefCalled, true);
  fixture.controller.dispose();
  assert.equal(fixture.timers.size, 0);
});

test('uninitialized cloud scopes are seeded from the authorized desktop', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: { initialized: false, revision: 0, values: {} },
        songs: { initialized: false, revision: 0 },
        bilibili: { initialized: false, revision: 0, loggedIn: false },
      }),
    },
    bilibiliAuth: {
      getAuthState: async () => ({ loggedIn: true, uid: 42 }),
      getCookieHeader: async () =>
        'DedeUserID=42; SESSDATA=local; bili_jct=local-csrf',
    },
  });
  await fixture.controller.start();
  assert.deepEqual(
    fixture.calls.map((call) => call[0]),
    ['push-settings', 'push-songs', 'push-bilibili'],
  );
  fixture.controller.dispose();
});

test('an older initialized cloud state preserves and seeds the local blind-box config', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: {
          initialized: true,
          revision: 2,
          values: {
            roomId: '123',
            enableBilibili: true,
            paused: false,
            queueLimit: 50,
            userCooldownSeconds: 0,
            onlyFromLibrary: false,
            allowDuplicate: true,
          },
        },
        songs: { initialized: true, revision: 3 },
        bilibili: { initialized: true, revision: 4, loggedIn: true },
      }),
    },
  });

  await fixture.controller.start();

  const applied = fixture.calls.find((call) => call[0] === 'apply-settings');
  assert.equal(
    Object.prototype.hasOwnProperty.call(applied[1], 'giftBlindBoxConfig'),
    false,
  );
  const seeded = fixture.calls.find((call) => call[0] === 'push-settings');
  assert.deepEqual(seeded[1].giftBlindBoxConfig, LOCAL_BLIND_BOX_CONFIG);
  fixture.controller.dispose();
});

test('an explicit empty cloud blind-box config is applied without reseeding', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: {
          initialized: true,
          revision: 2,
          values: {
            roomId: '123',
            enableBilibili: true,
            paused: false,
            queueLimit: 50,
            userCooldownSeconds: 0,
            onlyFromLibrary: false,
            allowDuplicate: true,
            giftBlindBoxConfig: [],
          },
        },
        songs: { initialized: true, revision: 3 },
        bilibili: { initialized: true, revision: 4, loggedIn: true },
      }),
    },
  });

  await fixture.controller.start();

  assert.deepEqual(
    fixture.calls.find((call) => call[0] === 'apply-settings')[1]
      .giftBlindBoxConfig,
    [],
  );
  assert.equal(
    fixture.calls.some((call) => call[0] === 'push-settings'),
    false,
  );
  fixture.controller.dispose();
});

test('an uninitialized Bilibili scope is seeded as logged out', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: { initialized: true, revision: 1, values: {} },
        songs: { initialized: true, revision: 1 },
        bilibili: { initialized: false, revision: 0, loggedIn: false },
      }),
      getCloudSongs: async () => ({
        songs: [],
        initialized: true,
        revision: 1,
      }),
    },
  });
  await fixture.controller.start();
  assert.equal(
    fixture.calls.some((call) => call[0] === 'clear-bilibili'),
    true,
  );
  fixture.controller.dispose();
});

test('a failed dirty upload is retried and blocks an older cloud pull', async () => {
  let attempts = 0;
  const fixture = createFixture({
    licenseManager: {
      updateCloudSettings: async (settings) => {
        attempts += 1;
        fixture.calls.push(['push-settings', settings]);
        if (attempts === 1) throw new Error('NETWORK_UNAVAILABLE');
        return { initialized: true, revision: 8, values: settings };
      },
    },
  });
  fixture.emitLocal('settings');
  await fixture.controller.whenIdle();
  assert.equal(attempts, 1);
  assert.equal(
    fixture.calls.some((call) => call[0] === 'apply-settings'),
    false,
  );

  await fixture.controller.syncNow();
  assert.equal(attempts, 2);
  assert.equal(
    fixture.calls.some((call) => call[0] === 'apply-settings'),
    false,
  );
  fixture.controller.dispose();
});

test('authorization loss stops polling and dispose removes both subscriptions', async () => {
  const fixture = createFixture();
  await fixture.controller.start();
  assert.equal(fixture.timers.size, 1);
  fixture.emitState('blocked');
  assert.equal(fixture.timers.size, 0);
  fixture.controller.dispose();
  fixture.emitLocal('songs');
  await fixture.controller.whenIdle();
  assert.equal(
    fixture.calls.some((call) => call[0] === 'push-songs'),
    false,
  );
});

test('a failed cloud poll still schedules the next retry', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => {
        throw new Error('NETWORK_UNAVAILABLE');
      },
    },
  });
  await assert.rejects(fixture.controller.start(), /NETWORK_UNAVAILABLE/);
  assert.equal(fixture.timers.size, 1);
  fixture.controller.dispose();
});

test('an online cloud revision event immediately reconciles without waiting for fallback polling', async () => {
  let settingsRevision = 2;
  let cloudReads = 0;
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => {
        cloudReads += 1;
        return {
          settings: {
            initialized: true,
            revision: settingsRevision,
            values: {
              roomId: String(settingsRevision),
              enableBilibili: true,
              paused: false,
              queueLimit: 50,
              userCooldownSeconds: 0,
              onlyFromLibrary: false,
              allowDuplicate: true,
              giftBlindBoxConfig: CLOUD_BLIND_BOX_CONFIG,
            },
          },
          songs: { initialized: true, revision: 3 },
          bilibili: { initialized: true, revision: 4, loggedIn: true },
        };
      },
    },
  });
  await fixture.controller.start();
  const readsAfterStart = cloudReads;
  const appliesAfterStart = fixture.calls.filter(
    (call) => call[0] === 'apply-settings',
  ).length;

  settingsRevision = 9;
  fixture.emitCloud({ scopes: { settings: 9 } });
  await fixture.controller.whenIdle();

  assert.equal(cloudReads, readsAfterStart + 1);
  assert.equal(
    fixture.calls.filter((call) => call[0] === 'apply-settings').length,
    appliesAfterStart + 1,
  );
  assert.equal(
    [...fixture.timers.values()].some((timer) => timer.delay === 600_000),
    true,
  );
  fixture.controller.dispose();
});

test('a closed event stream reconnects with bounded backoff and reconciles on reopen', async () => {
  let attempts = 0;
  let cloudReads = 0;
  let keepSecondOpen;
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => {
        cloudReads += 1;
        return {
          settings: { initialized: true, revision: 2, values: {} },
          songs: { initialized: true, revision: 3 },
          bilibili: { initialized: true, revision: 4, loggedIn: true },
        };
      },
      watchCloudStateChangesInternal: async (options = {}) => {
        attempts += 1;
        options.onOpen?.();
        if (attempts === 1) return;
        await new Promise((resolve) => {
          keepSecondOpen = resolve;
          options.signal?.addEventListener('abort', resolve, { once: true });
        });
      },
    },
  });

  await fixture.controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  const reconnect = [...fixture.timers.values()].find(
    (timer) => timer.delay === 1_000,
  );
  assert.ok(reconnect);
  reconnect.callback();
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.controller.whenIdle();

  assert.equal(attempts, 2);
  assert.equal(cloudReads, 2);
  fixture.controller.dispose();
  keepSecondOpen?.();
});
