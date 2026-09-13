'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createShutdownHarness } = require('./helpers/electron-shutdown');

test('main locks the durable root before migration and separates browser paths before ready', async () => {
  const h = createShutdownHarness();
  const events = h.storageCalls;
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
