'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createShutdownHarness } = require('../helpers/electron-shutdown');

test('main locks the durable root before migration and separates browser paths before ready', async () => {
  const h = createShutdownHarness();
  assert.equal(h.storageCalls[0].type, 'legacy-check');
  const events = h.storageCalls.slice(1);
  const root = events[0].value;
  assert.equal(events[0].name, 'userData');
  assert.equal(events[1].type, 'lock');
  assert.equal(events[2].type, 'browser-migration');
  assert.equal(events[3].type, 'cache-migration');
  const profile = events.find((event) => event.name === 'sessionData');
  assert.equal(profile.value, path.join(root, 'browser'));
  assert.equal(events.at(-1).type, 'ready');
  await h.start();
  assert.equal(h.state.paths.dataDir, root);
  assert.equal(h.state.paths.logDir, path.join(path.dirname(root), 'logs'));
});

test('a locked legacy source stops before target locking, profile migration or runtime startup', async () => {
  const h = createShutdownHarness({ legacyMigrationError: new Error('Close the running LIRA before migrating legacy storage.') });
  await h.start({ expectStartupError: true });
  assert.match(h.startupErrors[0], /Close the running LIRA/);
  assert.deepEqual(h.storageCalls, [{ type: 'legacy-check' }]);
  assert.equal(h.count('runtime:start'), 0);
  assert.equal(h.count('app:exit'), 1);
});

test('a second instance cannot move any profile or cache entries', async () => {
  const h = createShutdownHarness({ instanceLock: false });
  await h.start();
  assert.equal(
    h.storageCalls.some((event) => event.type.endsWith('migration')),
    false,
  );
  assert.equal(h.count('runtime:start'), 0);
  assert.equal(h.count('app:default-quit'), 1);
});

test('failed profile migration stops before Chromium ready and backend initialization', async () => {
  const h = createShutdownHarness({
    migrationError: new Error('profile is locked'),
  });
  await h.start({ expectStartupError: true });
  assert.match(h.startupErrors[0], /profile is locked/);
  assert.equal(
    h.storageCalls.some((event) => event.type === 'ready'),
    false,
  );
  assert.equal(h.count('runtime:start'), 0);
  assert.equal(h.count('app:exit'), 1);
});

for (const stage of ['runtimeStart', 'licenseBootstrap']) {
  test(`failed ${stage} exits through cleanup even when the startup error dialog fails`, async () => {
    const pending = Promise.withResolvers();
    const h = createShutdownHarness({
      [stage]: pending,
      expectedExitCode: 1,
      startupReportError: new Error('error dialog unavailable'),
    });
    await h.start();
    pending.reject(new Error('startup stage failed'));
    h.backendStop.resolve();
    await h.settle();
    assert.match(h.startupErrors[0], /startup stage failed/);
    assert.equal(h.count('runtime:stop'), 1);
    assert.equal(h.count('app:exit'), 1);
    assert.equal(h.clock.pending, 0);
    assert.equal(h.state.window.main, null);
  });
}
