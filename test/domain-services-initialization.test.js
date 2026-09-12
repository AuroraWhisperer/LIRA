'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

// Establish isolation before importing any product module.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-domain-init-'));
const realRoot = fs.realpathSync(root);
const previousDataDir = process.env.SONG_PLUGIN_DATA_DIR;
process.env.SONG_PLUGIN_DATA_DIR = root;
test.after(() => {
  if (previousDataDir === undefined) delete process.env.SONG_PLUGIN_DATA_DIR;
  else process.env.SONG_PLUGIN_DATA_DIR = previousDataDir;
  assert.equal(fs.realpathSync(root), realRoot);
  fs.rmSync(root, { recursive: true, force: true });
});

const { createDatabases, closeDatabases } = require('../src/storage/database');
const { createSettingsStore } = require('../src/storage/settings-store');
const { createOvertimeStore } = require('../src/overtime/overtime-store');
const overtimeModule = require('../src/overtime');
const giftModule = require('../src/bilibili/gift');
const saleModule = require('../src/bilibili/gift/sale-catalog');

function loadModule(relativePath, overrides = {}, globals = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: (name) => overrides[name] || localRequire(name),
    console,
    queueMicrotask,
    __dirname: path.dirname(filename),
    __filename: filename,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...globals,
  }, { filename });
  return module.exports;
}

function createClock() {
  let now = Date.parse('2026-09-12T00:00:00Z');
  const timers = new Map();
  let scheduled = 0;
  let fired = 0;
  return {
    timers,
    now: () => now,
    scheduled: () => scheduled,
    fired: () => fired,
    setTimeout(callback, delay) {
      const handle = { unref() {} };
      timers.set(handle, { callback, due: now + delay });
      scheduled += 1;
      return handle;
    },
    clearTimeout: (handle) => timers.delete(handle),
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timers.has(handle) && timer.due <= now) {
          timers.delete(handle);
          fired += 1;
          timer.callback();
        }
      }
    },
  };
}

function fixture({ failure = '', cleanupFails = false, shared = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(root, 'case-'));
  const db = createDatabases({ dataDir });
  const settingsStore = createSettingsStore(db.songDb);
  const clock = createClock();
  const originalError = new Error(`assembly: ${failure}`);
  const events = [];
  const warnings = [];
  const listeners = new Set();
  const services = [];
  let phase = failure;
  let borrowedStops = 0;
  let closed = false;
  db.giftDb.prepare(`UPDATE overtime_machine_state SET enabled=1, enable_epoch=1,
    status='running', remaining_ms=60000, anchor_at_ms=?, revision=7 WHERE id=1`).run(clock.now());
  db.giftDb.exec(`INSERT INTO gift_events (id, overtime_epoch, detection_status, created_at, updated_at)
    VALUES (1, 1, 'final', 'a', 'a');`);
  db.giftDb.prepare(`INSERT INTO overtime_settlements
    (gift_event_id, status, settle_after_ms, created_at, updated_at)
    VALUES (1, 'pending', ?, 'a', 'a')`).run(clock.now() + 5000);
  const stopBorrowed = () => { borrowedStops += 1; };
  const remoteCatalog = { getSnapshot() {
    if (phase === 'hybrid') throw originalError;
    return null;
  }, refresh: async () => null,
    start: () => events.push('remote:start'), stop: stopBorrowed };
  const initializer = {
    onStateChanged(listener) {
      listeners.add(listener);
      return () => { events.push('unsubscribe'); listeners.delete(listener); };
    },
    stop: stopBorrowed,
    dispose: stopBorrowed,
  };
  const hybridModule = loadModule('src/bilibili/gift/hybrid-catalog.js', {
    './remote-catalog-cache': {
      createRemoteGiftCatalogCache: () => ({ ...remoteCatalog, stop() {
        events.push('remote:stop');
        if (cleanupFails) throw new Error('remote stop failed');
      } }),
    },
  });
  const domain = loadModule('src/server/domain-services.js', {
    '../overtime': { ...overtimeModule, createOvertimeService(options) {
      const store = createOvertimeStore(options.giftDb);
      if (phase === 'recovery') store.listRecoverableFinal = () => { throw originalError; };
      const service = overtimeModule.createOvertimeService({ ...options, store,
        now: clock.now, monotonicNow: clock.now,
        setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
      services.push(service);
      return { ...service, dispose() { events.push('overtime:dispose'); service.dispose(); } };
    } },
    '../bilibili/gift/sale-catalog': { ...saleModule, createGiftSaleCatalogService(options) {
      assert.equal(clock.timers.size, 2, 'clock and retry exist before catalog creation');
      if (phase === 'catalog') throw originalError;
      return saleModule.createGiftSaleCatalogService(options);
    } },
    '../bilibili/gift/hybrid-catalog': hybridModule,
    '../bilibili/gift': { ...giftModule, createGiftService(context, options) {
      assert.equal(listeners.size, 1, 'hybrid subscribed before gift construction');
      if (phase === 'gift') throw originalError;
      const service = giftModule.createGiftService(context, options);
      services.push(service);
      const result = { ...service, dispose() {
        events.push('gift:dispose');
        service.dispose();
        if (cleanupFails) throw new Error('gift dispose failed');
      } };
      if (phase === 'gift-result') Object.defineProperty(result, 'assemblyProbe', {
        enumerable: true, get() { throw originalError; },
      });
      return result;
    } },
  }, { console: { ...console, warn: (...args) => warnings.push(args) } });
  const options = {
    db, settingsStore, dataDir,
    giftEffectResolver: { dispose: stopBorrowed, close: stopBorrowed },
    remoteGiftCatalog: {
      fetch: async () => { throw new Error('unexpected remote fetch'); },
      ...(shared ? { remoteCatalog } : {}),
      giftCatalogInitializer: initializer,
      remoteImageCache: { stop: stopBorrowed, dispose: stopBorrowed },
    },
  };
  return { db, clock, events, warnings, listeners, originalError, dataDir,
    remoteOptions: options.remoteGiftCatalog,
    borrowedStops: () => borrowedStops,
    create: () => domain.createDomainServices(options),
    createWith: (runtimeOptions) => domain.createDomainServices(runtimeOptions),
    retry() { phase = ''; return domain.createDomainServices(options); },
    closeDatabases() {
      closeDatabases(db);
      closed = true;
      events.push('database:close');
    },
    cleanup() {
      for (const service of services) service.dispose();
      clock.timers.clear();
      listeners.clear();
      if (!closed) closeDatabases(db);
    },
  };
}

for (const failure of ['catalog', 'hybrid', 'gift', 'recovery']) {
  test(`${failure} failure cancels restored clocks before borrowed databases close`, () => {
    const f = fixture({ failure });
    try {
      assert.throws(f.create, (error) => error === f.originalError);
      assert.equal(f.clock.scheduled(), 2);
      assert.equal(f.clock.timers.size, 0);
      assert.equal(f.listeners.size, 0);
      assert.equal(f.borrowedStops(), 0);
      const state = f.db.giftDb.prepare('SELECT * FROM overtime_machine_state').get();
      assert.equal(state.enabled, 1);
      assert.equal(state.status, 'running');
      assert.equal(state.remaining_ms, 60000);
      assert.equal(state.revision, 7);
      assert.equal(f.db.giftDb.prepare('SELECT status FROM overtime_settlements').get().status, 'pending');
      for (const db of Object.values(f.db)) assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1);
      f.closeDatabases();
      assert.doesNotThrow(() => f.clock.advance(120000));
      assert.equal(f.clock.fired(), 0);
    } finally {
      f.cleanup();
    }
  });
}

test('cleanup failures preserve the assembly error and release remaining owned resources', () => {
  const f = fixture({ failure: 'gift-result', cleanupFails: true, shared: false });
  try {
    assert.throws(f.create, (error) => error === f.originalError);
    assert.deepEqual(f.events, ['gift:dispose', 'unsubscribe', 'remote:stop', 'overtime:dispose']);
    assert.equal(f.warnings.length, 2);
    assert.equal(f.clock.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.borrowedStops(), 0);
    f.closeDatabases();
    assert.doesNotThrow(() => f.clock.advance(120000));
  } finally {
    f.cleanup();
  }
});

test('failed assembly can retry and transfers successful services to normal shutdown', () => {
  const f = fixture({ failure: 'gift' });
  try {
    assert.throws(f.create, (error) => error === f.originalError);
    assert.equal(f.listeners.size, 0);
    const services = f.retry();
    assert.equal(f.clock.timers.size, 2);
    assert.equal(f.listeners.size, 1);
    assert.equal(f.borrowedStops(), 0);
    assert.equal(services.overtime.getSnapshot().status, 'running');
    // Preserve the existing reversible start/stop behavior for successful callers.
    services.overtimeGiftCatalog.start();
    services.gifts.dispose();
    services.overtimeGiftCatalog.stop();
    services.overtime.dispose();
    assert.equal(f.clock.timers.size, 0);
    assert.equal(f.borrowedStops(), 1);
    services.overtimeGiftCatalog.dispose();
    services.overtimeGiftCatalog.dispose();
    assert.equal(f.listeners.size, 0);
    assert.equal(f.borrowedStops(), 1);
    f.closeDatabases();
    f.clock.advance(120000);
    const reopened = createDatabases({ dataDir: f.dataDir });
    try {
      assert.equal(reopened.giftDb.prepare('SELECT status FROM overtime_machine_state').get().status, 'running');
    } finally {
      closeDatabases(reopened);
    }
  } finally {
    f.cleanup();
  }
});

test('server startup failure disposes the domain before closing its database handles', async () => {
  const f = fixture({ failure: 'gift' });
  f.closeDatabases();
  let acquired;
  let closeCount = 0;
  const serverModule = loadModule('src/server.js', {
    './server/domain-services': { createDomainServices: f.createWith },
    './storage/database': { ...require('../src/storage/database'),
      createDatabases(options) { acquired = createDatabases(options); return acquired; },
      closeDatabases(db) {
        assert.equal(f.clock.timers.size, 0);
        assert.equal(f.listeners.size, 0);
        closeCount += 1;
        closeDatabases(db);
      },
    },
  });
  const runtime = serverModule.createServerRuntime({ dataDir: f.dataDir });
  try {
    await assert.rejects(runtime.start({ startPort: 0, remoteGiftCatalog: f.remoteOptions }),
      (error) => error === f.originalError);
    assert.equal(closeCount, 1);
    assert.ok(Object.values(acquired).every((db) => !db.isOpen));
    assert.equal(f.borrowedStops(), 0);
    assert.doesNotThrow(() => f.clock.advance(120000));
    assert.equal(f.clock.fired(), 0);
  } finally {
    await runtime.stop();
    f.cleanup();
  }
});

test('hybrid acquires a listener at construction and starts polling only on start', () => {
  const intervals = new Set();
  const listeners = new Set();
  const remoteModule = loadModule('src/bilibili/gift/remote-catalog-cache.js', {}, {
    setInterval() { const timer = { unref() {} }; intervals.add(timer); return timer; },
    clearInterval: (timer) => intervals.delete(timer),
  });
  const { createHybridGiftSaleCatalogService } = loadModule('src/bilibili/gift/hybrid-catalog.js', {
    './remote-catalog-cache': remoteModule,
  });
  const catalog = createHybridGiftSaleCatalogService({
    dataDir: fs.mkdtempSync(path.join(root, 'hybrid-')),
    local: saleModule.createUnavailableGiftSaleCatalogService(),
    fetchRemote: async () => { throw new Error('unexpected network access'); },
    remoteImageCache: {},
    giftCatalogInitializer: {
      onStateChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
  });
  try {
    assert.equal(listeners.size, 1);
    assert.equal(intervals.size, 0);
    catalog.start();
    assert.equal(intervals.size, 1);
    catalog.stop();
    assert.equal(intervals.size, 0);
    catalog.start();
    assert.equal(intervals.size, 1);
    catalog.dispose();
    assert.equal(intervals.size, 0);
    assert.equal(listeners.size, 0);
    catalog.dispose();
    catalog.start();
    assert.equal(intervals.size, 0);
  } finally {
    catalog.stop();
    catalog.dispose();
  }
});
