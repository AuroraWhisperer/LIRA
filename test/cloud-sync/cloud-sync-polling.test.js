'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHook } = require('node:async_hooks');
const { createRemoteLicenseClient } = require('../../src/electron/license/remote-license-client');
const { createFixture, CLOUD_BLIND_BOX_CONFIG } = require('../helpers/cloud-sync-controller-fixture');

test('cloud notification bursts need at most one trailing sync while a read is pending', async (t) => {
  let reads = 0;
  let release;
  const state = {
    settings: { initialized: true, revision: 2000, values: { giftBlindBoxConfig: [] } },
    songs: { initialized: true, revision: 3 },
    bilibili: { initialized: false, revision: 0, loggedIn: false },
  };
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => {
        reads += 1;
        if (reads === 1)
          await new Promise((resolve) => {
            release = resolve;
          });
        return state;
      },
    },
  });
  t.after(() => fixture.controller.dispose());
  const starting = fixture.controller.start();
  await new Promise(setImmediate);
  let promises = 0;
  const hook = createHook({
    init(_id, type) {
      if (type === 'PROMISE') promises += 1;
    },
  });
  hook.enable();
  try {
    for (let revision = 1; revision <= 2000; revision += 1) {
      fixture.emitCloud({ scopes: { settings: revision } });
    }
  } finally {
    hook.disable();
  }
  release();
  await starting;
  await fixture.controller.whenIdle();
  assert.ok(reads <= 2, `burst caused ${reads} cloud reads`);
  assert.equal(fixture.calls.filter(([name]) => name === 'apply-settings').length, 1);
  assert.ok(promises < 20, `coalesced notifications still retained ${promises} promise branches`);
  t.diagnostic(`2000 notifications: ${reads} cloud reads and ${promises} promise branches`);
});

test('cloud sync keeps one fallback timer across 10000 notifications', async (t) => {
  let revision = 0;
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: { initialized: true, revision, values: { giftBlindBoxConfig: [] } },
        songs: { initialized: true, revision: 3 },
        bilibili: { initialized: false, revision: 0, loggedIn: false },
      }),
    },
  });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  for (let notification = 0; notification < 10_000; notification += 1) {
    revision += 1;
    fixture.emitCloud({ scopes: { settings: revision } });
    await fixture.controller.whenIdle();
    assert.equal(fixture.timers.size, 1);
  }
});

test('fallback polling reads cloud state, reschedules once and stops after shutdown', async (t) => {
  let reads = 0;
  let now = 0;
  const fixture = createFixture({
    now: () => now,
    licenseManager: {
      async getCloudState() {
        reads += 1;
        return {
          settings: { initialized: true, revision: 0, values: { giftBlindBoxConfig: [] } },
          songs: { initialized: true, revision: 3 },
          bilibili: { initialized: false, revision: 0, loggedIn: false },
        };
      },
    },
  });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  assert.equal(reads, 1);
  const [timer] = fixture.timers.values();
  assert.equal(timer.delay, 600_000);
  now += timer.delay;
  fixture.timers.delete(timer.id);
  timer.callback();
  await fixture.controller.whenIdle();
  assert.equal(reads, 2);
  assert.equal(fixture.timers.size, 1);
  const [nextTimer] = fixture.timers.values();
  assert.notEqual(nextTimer.id, timer.id);
  assert.equal(nextTimer.delay, 600_000);
  fixture.controller.dispose();
  assert.equal(fixture.timers.size, 0);
  nextTimer.callback();
  fixture.emitCloud({ scopes: { settings: 1 } });
  await fixture.controller.whenIdle();
  assert.equal(reads, 2);
  assert.equal(fixture.timers.size, 0);
});

test('cloud SSE recovery honors the real Retry-After header beyond the backoff cap', async () => {
  const client = createRemoteLicenseClient({
    fetchImpl: async () => new Response('null', { status: 429, headers: { 'Retry-After': '120' } }),
  });
  const fixture = createFixture({
    licenseManager: {
      watchCloudStateChangesInternal: (options) => client.watchCloudStateChanges('token', options),
    },
  });
  try {
    await fixture.controller.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok([...fixture.timers.values()].some((timer) => timer.delay === 120_000));
    assert.equal(
      [...fixture.timers.values()].some((timer) => timer.delay === 1000),
      false,
    );
  } finally {
    fixture.controller.dispose();
  }
});

test('cloud SSE start, restart and stale timers cannot bypass Retry-After', async () => {
  let connections = 0;
  const client = createRemoteLicenseClient({
    fetchImpl: async () => {
      connections += 1;
      return new Response('busy', { status: 429, headers: { 'Retry-After': '60' } });
    },
  });
  const fixture = createFixture({
    now: () => 0,
    licenseManager: {
      watchCloudStateChangesInternal: (options) => client.watchCloudStateChanges('token', options),
    },
  });
  try {
    await fixture.controller.start();
    await new Promise((resolve) => setImmediate(resolve));
    const oldRetry = [...fixture.timers.values()].find((timer) => timer.delay === 60_000);
    await fixture.controller.start();
    assert.equal(connections, 1);
    fixture.controller.stop();
    await fixture.controller.start();
    assert.equal(connections, 1);
    const currentRetry = [...fixture.timers.values()].find((timer) => timer.delay === 60_000);
    assert.notEqual(oldRetry, currentRetry);
    oldRetry.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connections, 1);
    currentRetry.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connections, 2);
  } finally {
    fixture.controller.dispose();
  }
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
  const appliesAfterStart = fixture.calls.filter((call) => call[0] === 'apply-settings').length;

  settingsRevision = 9;
  fixture.emitCloud({ scopes: { settings: 9 } });
  await fixture.controller.whenIdle();

  assert.equal(cloudReads, readsAfterStart + 1);
  assert.equal(fixture.calls.filter((call) => call[0] === 'apply-settings').length, appliesAfterStart + 1);
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
  const reconnect = [...fixture.timers.values()].find((timer) => timer.delay === 1_000);
  assert.ok(reconnect);
  reconnect.callback();
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.controller.whenIdle();

  assert.equal(attempts, 2);
  assert.equal(cloudReads, 2);
  fixture.controller.dispose();
  keepSecondOpen?.();
});
