'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHook } = require('node:async_hooks');
const { createFixture } = require('./helpers/cloud-sync-controller-fixture');

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
        if (reads === 1) await new Promise((resolve) => { release = resolve; });
        return state;
      },
    },
  });
  t.after(() => fixture.controller.dispose());
  const starting = fixture.controller.start();
  await new Promise(setImmediate);
  let promises = 0;
  const hook = createHook({ init(_id, type) { if (type === 'PROMISE') promises += 1; } });
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
