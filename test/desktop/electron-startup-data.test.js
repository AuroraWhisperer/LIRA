'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const test = require('node:test');
const { createShutdownHarness } = require('../helpers/electron-shutdown');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createResourceLibrary } = require('../../src/resources/resource-library');

test('main resource initialization downloads through Electron net.fetch', async (t) => {
  const dataDir = createScratchDirectory('desktop-resource-fetch-', t);
  const bytes = Buffer.from('desktop resource fixture');
  const file = { path: 'img/startup.png', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected Node network request'); });
  let resources;
  t.after(async () => { await resources?.close(); });
  const stopAfterResources = new Error('Resource library constructed');
  const server = { listening: false, close(done) { this.listening = false; done(); }, closeAllConnections() {} };
  const overrides = {
    'node:fs': { mkdirSync() {} },
    './server/http-server': { createHttpServer: () => server },
    './storage/data-directory-migration': { migrateCacheData() {} },
    './storage/database': { createDatabases: () => ({ lotteryDb: {} }), closeDatabases() {}, optimizeDatabases() {} },
    './server/dynamic-lottery-runtime': { createDynamicLotteryRuntime: () => ({ dispose() {} }) },
    './server/lifecycle': {
      cleanupOwnPortOccupant: async () => {},
      listenExactly: async () => { server.listening = true; return 0; },
      removeSessionToken() {}, removeRuntimeInfo() {},
    },
    './resources/resource-library': {
      createResourceLibrary(options) {
        resources = createResourceLibrary({ ...options, dataDir, publicDir: path.join(dataDir, 'public'),
          files: [file], logger: { warn() {} } });
        // Stop unrelated startup after the real server has constructed its resource owner.
        throw stopAfterResources;
      },
    },
  };
  const filename = require.resolve('../../src/server');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    __dirname: path.dirname(filename), __filename: filename,
    console: { ...console, warn() {}, log() {} }, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename });
  const h = createShutdownHarness({ serverModule: module.exports, expectedExitCode: 1,
    netFetch: async (url, options) => {
      requests.push({ url, options });
      return new URL(url).pathname.endsWith('/manifest.json')
        ? Response.json({ version: 1, files: [file] }) : new Response(bytes);
    } });
  await h.start({ expectStartupError: true });
  await h.shutdownPromise;
  assert.ok(resources, 'main must reach the real resource constructor');
  assert.equal(server.listening, false);
  const state = await resources.initialize();
  assert.equal(state.status, 'ready');
  assert.deepEqual(fs.readFileSync(resources.resolveAsset(file.path)), bytes);
  assert.equal(requests.length, 2, 'the manifest and resource both use the desktop transport');
});

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
  assert.equal(h.runtimeOptions.dataDir, root);
  assert.equal(h.logDirectory, path.join(path.dirname(root), 'logs'));
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

test('failed legacy partition migration exits before account sessions or runtime initialize', async () => {
  const h = createShutdownHarness({
    partitionMigrationError: new Error('partition copy failed'),
    expectedExitCode: 1,
    startupReportError: new Error('error dialog unavailable'),
  });
  await h.start({ expectStartupError: true });
  await h.shutdownPromise;
  assert.equal(h.startupErrors.length, 1);
  assert.equal(h.count('music:restore-cookies'), 0);
  assert.equal(h.count('bilibili:restore-cookies'), 0);
  assert.equal(h.count('runtime:start'), 0);
  assert.equal(h.count('auth:dispose'), 1);
  assert.equal(h.count('app:exit'), 1);
  assert.equal(h.clock.pending, 0);
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
    assert.equal(h.window, null);
  });
}
