'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-cleanup-'));
const previousDataDir = process.env.SONG_PLUGIN_DATA_DIR;
process.env.SONG_PLUGIN_DATA_DIR = root;
test.after(() => {
  if (previousDataDir === undefined) delete process.env.SONG_PLUGIN_DATA_DIR;
  else process.env.SONG_PLUGIN_DATA_DIR = previousDataDir;
  assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
});

function loadServer(overrides = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../src/server.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: (name) => overrides[name] || localRequire(name),
    __dirname: path.dirname(filename), __filename: filename,
    console, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    ...globals,
  }, { filename });
  return module.exports;
}

for (const failurePhase of ['metadata', 'initialization']) {
test(`startup ${failurePhase} failure with cleanup failure preserves the error and permits retry`, async () => {
  const storage = require('../src/storage/database');
  const lifecycle = require('../src/server/lifecycle');
  const lotteryModule = require('../src/server/dynamic-lottery-runtime');
  const dataDir = fs.mkdtempSync(path.join(root, 'rollback-'));
  const initiatingError = new Error('synthetic runtime info write failure');
  let fail = true;
  let listener;
  let acquired;
  let disposeCount = 0;
  const warnings = [];
  const { createServerRuntime } = loadServer({
    './server/lifecycle': {
      ...lifecycle,
      async listenExactly(server, options) {
        listener = server;
        return lifecycle.listenExactly(server, options);
      },
      writeRuntimeInfo(dir, info) {
        lifecycle.writeRuntimeInfo(dir, info);
        if (fail && failurePhase === 'metadata') throw initiatingError;
      },
    },
    './server/dynamic-lottery-runtime': {
      createDynamicLotteryRuntime(options) {
        const runtime = lotteryModule.createDynamicLotteryRuntime(options);
        return { ...runtime, async dispose() {
          disposeCount++;
          await runtime.dispose();
          if (fail) throw new Error('synthetic lottery cleanup failure');
        } };
      },
    },
    './storage/database': {
      ...storage,
      createDatabases(options) {
        acquired = storage.createDatabases(options);
        return acquired;
      },
    },
  }, { console: { ...console, warn: (...args) => warnings.push(args) } });
  const runtime = createServerRuntime({
    dataDir, licenseGate: { isAuthorized: () => false },
    onPhase(name) {
      if (fail && failurePhase === 'initialization' && name === 'database-init') {
        throw initiatingError;
      }
    },
  });
  try {
    await assert.rejects(runtime.start({ startPort: 0 }), error => error === initiatingError);
    assert.equal(listener.listening, false);
    assert.ok(Object.values(acquired).every(db => !db.isOpen));
    assert.equal(runtime.getApiToken(), '');
    for (const file of ['.session-token', '.server-runtime.json']) {
      assert.equal(fs.existsSync(path.join(dataDir, file)), false);
    }
    assert.ok(warnings.some(args => String(args).includes('lottery cleanup failure')));
    fail = false;
    const app = await runtime.start({ startPort: 0 });
    assert.equal(app.server.listening, true);
    assert.ok(runtime.getApiToken());
    await runtime.stop();
    assert.equal(disposeCount, 2);
    assert.ok(Object.values(acquired).every(db => !db.isOpen));
  } finally {
    fail = false;
    await runtime.stop().catch(() => {});
    for (const db of Object.values(acquired || {})) if (db.isOpen) db.close();
    if (listener?.listening) await new Promise(resolve => listener.close(resolve));
  }
});
}

for (const late of [false, true]) {
  test(`exit request ${late ? 'after' : 'during'} shutdown is honored without repeating cleanup`, async () => {
    const dataDir = fs.mkdtempSync(path.join(root, 'exit-'));
    const exits = [];
    const fakeProcess = Object.create(process);
    fakeProcess.exit = code => exits.push(code);
    const { createServerRuntime } = loadServer({}, { process: fakeProcess });
    const runtime = createServerRuntime({ dataDir, licenseGate: { isAuthorized: () => false } });
    let release;
    let entered;
    const enteredHook = new Promise(resolve => { entered = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    let hooks = 0;
    runtime.setPreShutdownHook(async () => { hooks++; entered(); await hold; });
    try {
      const app = await runtime.start({ startPort: 0 });
      const stopping = runtime.stop();
      await enteredHook;
      assert.equal(app.server.listening, true);
      if (late) { release(); await stopping; }
      assert.equal(runtime.stop({ exitProcess: true }), stopping);
      if (!late) assert.deepEqual(exits, []);
      release();
      await stopping;
      assert.deepEqual(exits, [0]);
      assert.equal(runtime.stop(), stopping);
      assert.equal(runtime.stop({ exitProcess: true }), stopping);
      assert.deepEqual(exits, [0]);
      assert.equal(hooks, 1);
      assert.equal(app.server.listening, false);
    } finally {
      release();
      await runtime.stop();
    }
  });
}
