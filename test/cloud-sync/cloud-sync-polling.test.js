'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHook } = require('node:async_hooks');
const { createRemoteLicenseClient } = require('../../src/electron/license/remote-license-client');
const { createFixture, CLOUD_BLIND_BOX_CONFIG } = require('../helpers/cloud-sync-controller-fixture');

test('the authoritative song snapshot recovers from a restored backup and a reused revision', async (t) => {
  let summary = { initialized: true, revision: 42, updatedAt: '2026-11-18 03:00:00' };
  let snapshot = { ...summary, songs: [{ title: 'Before recovery' }] };
  let reads = 0;
  const fixture = createFixture({ licenseManager: {
    getCloudState: async () => ({
      settings: { initialized: true, revision: 2, values: { giftBlindBoxConfig: [] } },
      songs: summary,
      bilibili: { initialized: false, revision: 0 },
    }),
    async getCloudSongs() { reads += 1; return snapshot; },
  } });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  await fixture.controller.syncNow();
  assert.equal(reads, 1);

  // A restore and new edits can reuse a revision between the summary reads.
  summary = { ...summary, updatedAt: '2026-11-18 04:00:00' };
  snapshot = { ...summary, songs: [{ title: 'Reused revision' }] };
  await fixture.controller.syncNow();
  assert.equal(reads, 2);

  summary = { ...summary, revision: 8, updatedAt: '2026-11-17 03:00:00' };
  // Another write between reads makes the complete response the applied version.
  snapshot = { ...summary, revision: 9, updatedAt: '2026-11-18 05:00:00', songs: [{ title: 'Restored library' }] };
  fixture.controller.stop();
  await fixture.controller.start();
  summary = { initialized: true, revision: snapshot.revision, updatedAt: snapshot.updatedAt };
  await fixture.controller.syncNow();
  assert.equal(reads, 3);
  assert.deepEqual(fixture.calls.filter(([kind]) => kind === 'apply-songs').map(([, songs]) => songs[0].title),
    ['Before recovery', 'Reused revision', 'Restored library']);
  assert.equal(fixture.calls.some(([kind]) => kind === 'push-songs'), false);
});

test('restoring a legacy song database can remove the timestamp at the same revision', async (t) => {
  let summary = { initialized: true, revision: 1, updatedAt: '2026-11-18 03:00:00' };
  let songs = [{ title: 'Current library' }];
  const fixture = createFixture({ licenseManager: {
    getCloudState: async () => ({
      settings: { initialized: true, revision: 2, values: { giftBlindBoxConfig: [] } },
      songs: summary,
      bilibili: { initialized: false, revision: 0 },
    }),
    getCloudSongs: async () => ({ ...summary, songs }),
  } });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  summary = { ...summary, updatedAt: null };
  songs = [{ title: 'Legacy backup' }];
  await fixture.controller.syncNow();
  assert.deepEqual(fixture.calls.filter(([kind]) => kind === 'apply-songs').map(([, rows]) => rows[0].title),
    ['Current library', 'Legacy backup']);
});

test('an upload SSE echo before its response does not cause a redundant trailing read', async (t) => {
  let reads = 0;
  let revision = 2;
  const fixture = createFixture({ licenseManager: {
    async getCloudState() {
      reads += 1;
      return {
        settings: { initialized: true, revision, values: { giftBlindBoxConfig: [] } },
        songs: { initialized: true, revision: 3 },
        bilibili: { initialized: false, revision: 0 },
      };
    },
    async updateCloudSettings(values) {
      revision = 5;
      fixture.emitCloud({ scopes: { settings: revision } });
      return { initialized: true, revision, values };
    },
  } });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  const before = reads;
  const deadline = [...fixture.timers.values()].find(timer => timer.delay === 600_000);
  fixture.emitLocal('settings');
  await new Promise(setImmediate);
  await fixture.controller.whenIdle();
  assert.equal(reads - before, 0);
  assert.equal(fixture.timers.get(deadline.id), deadline);
  deadline.callback();
  await fixture.controller.whenIdle();
  assert.equal(reads - before, 1, 'the original recovery deadline still reads the authoritative summary');
});

test('queued cloud events merge scopes and still fetch changes newer than the running read', async (t) => {
  let release;
  let reads = 0;
  const state = (settings, songs) => ({
    settings: { initialized: true, revision: settings, values: { giftBlindBoxConfig: [] } },
    songs: { initialized: true, revision: songs },
    bilibili: { initialized: false, revision: 0 },
  });
  const fixture = createFixture({ licenseManager: {
    async getCloudState() {
      reads += 1;
      if (reads === 1) {
        await new Promise((resolve) => { release = resolve; });
        return state(2, 3);
      }
      return state(2, 9);
    },
    getCloudSongs: async () => ({ initialized: true, revision: reads === 1 ? 3 : 9, songs: [] }),
  } });
  t.after(() => fixture.controller.dispose());
  const starting = fixture.controller.start();
  await new Promise(setImmediate);
  fixture.emitCloud({ scopes: { settings: 2 } });
  fixture.emitCloud({ scopes: { songs: 9 } });
  release();
  await starting;
  await fixture.controller.whenIdle();
  assert.equal(reads, 2);
});

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

for (const firstStatus of [200, 503]) {
  test(`SSE reconnect reconciles a missed revision after an initial HTTP ${firstStatus}`, async (t) => {
    let attempts = 0;
    let cloudReads = 0;
    let revision = 1;
    const client = createRemoteLicenseClient({ fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1 && firstStatus === 503) return new Response(null, { status: 503 });
      return new Response(attempts === 1 ? '' : new ReadableStream(), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    } });
    const fixture = createFixture({ licenseManager: {
      watchCloudStateChangesInternal: (options) => client.watchCloudStateChanges('fixture', options),
      async getCloudState() {
        cloudReads += 1;
        return {
          settings: { initialized: true, revision, values: { roomId: String(revision), giftBlindBoxConfig: [] } },
          songs: { initialized: true, revision: 3 },
          bilibili: { initialized: false, revision: 0 },
        };
      },
    } });
    t.after(() => fixture.controller.dispose());
    await fixture.controller.start();
    await new Promise(setImmediate);
    assert.equal(cloudReads, 1);
    const reconnect = [...fixture.timers.values()].find((timer) => timer.delay === 1_000);
    assert.ok(reconnect);
    revision = 2;
    reconnect.callback();
    await new Promise(setImmediate);
    await fixture.controller.whenIdle();
    assert.equal(attempts, 2);
    const rooms = fixture.calls.filter(([kind]) => kind === 'apply-settings').map(([, values]) => values.roomId);
    assert.deepEqual({ cloudReads, rooms }, { cloudReads: 2, rooms: ['1', '2'] });
  });
}
