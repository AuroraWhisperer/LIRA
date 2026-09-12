'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Writable } = require('node:stream');
const test = require('node:test');
const vm = require('node:vm');
const {
  parseArguments,
  buildCaptureRecord,
  shouldCaptureMessage,
  loadBilibiliDesktopAuth,
} = require('../scripts/capture-bilibili-events');

test('capture arguments accept room, duration, output, and gift filter', () => {
  const options = parseArguments(
    [
      '--room',
      '123',
      '--duration',
      '90',
      '--output',
      'tmp/capture.ndjson',
      '--bilibili-user-data',
      'tmp/electron-user-data',
      '--gift-only',
    ],
    process.cwd(),
  );

  assert.equal(options.roomId, '123');
  assert.equal(options.durationMs, 90_000);
  assert.equal(
    options.outputPath,
    path.join(process.cwd(), 'tmp', 'capture.ndjson'),
  );
  assert.equal(options.giftOnly, true);
  assert.equal(
    options.bilibiliUserDataPath,
    path.join(process.cwd(), 'tmp', 'electron-user-data'),
  );
});

test('capture records retain decoded command data without transport credentials', () => {
  assert.deepEqual(
    buildCaptureRecord(
      { cmd: 'GUARD_BUY', data: { uid: 42 } },
      '2026-08-03T12:00:00.000Z',
    ),
    {
      type: 'event',
      receivedAt: '2026-08-03T12:00:00.000Z',
      cmd: 'GUARD_BUY',
      data: { uid: 42 },
    },
  );
});

test('gift-only mode retains guard messages and excludes danmaku', () => {
  assert.equal(shouldCaptureMessage({ cmd: 'GUARD_BUY' }, true), true);
  assert.equal(
    shouldCaptureMessage({ cmd: 'DANMU_MSG:4:0:2:2:2:0' }, true),
    false,
  );
  assert.equal(
    shouldCaptureMessage({ cmd: 'DANMU_MSG:4:0:2:2:2:0' }, false),
    true,
  );
});

test('capture arguments reject a missing room and invalid duration', () => {
  assert.throws(() => parseArguments([], process.cwd()), /--room/);
  assert.throws(
    () => parseArguments(['--room', '123', '--duration', '0'], process.cwd()),
    /duration/,
  );
});

test('desktop login data requires the Electron capture entry point', async () => {
  await assert.rejects(
    loadBilibiliDesktopAuth('tmp/electron-user-data'),
    /requires running this script with Electron/,
  );
});

function captureFixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-capture-test-'));
  const outputPath = path.join(directory, 'events.ndjson');
  const signals = new EventEmitter();
  signals.env = {};
  const timers = new Set();
  const records = [];
  let writer;
  let releaseWrite;
  const failure = Object.assign(new Error(`synthetic ${options.fault} failure`), { code: 'EIO' });
  const connection = new EventEmitter();
  connection.closeCount = 0;
  connection.connectCount = 0;
  connection.clearHandlers = () => connection.removeAllListeners();
  connection.close = () => { connection.closeCount += 1; connection.emit('close'); };
  connection.connect = async () => {
    connection.connectCount += 1;
    if (options.fault === 'connect') throw failure;
    if (options.connectPending) {
      if (options.fault === 'connecting') setImmediate(() => writer.destroy(failure));
      return new Promise(() => {});
    }
    setImmediate(() => connection.emit('open'));
  };
  const filename = path.resolve(__dirname, '../scripts/capture-bilibili-events.js');
  const context = vm.createContext({
    module: { exports: {} }, Buffer, AbortController,
    process: signals,
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) {
      if (name === 'node:fs') return {
        ...fs,
        createWriteStream(file, flags) {
          assert.equal(flags.flags, 'wx');
          if (!options.fault && !options.backpressure) {
            writer = fs.createWriteStream(file, flags);
          } else {
            writer = new Writable({
              highWaterMark: 1,
              write(chunk, encoding, callback) {
                records.push(JSON.parse(chunk.toString()));
                if (options.fault === 'write-throw') throw failure;
                else if (options.fault === 'write') callback(failure);
                else if (options.backpressure && !releaseWrite) releaseWrite = callback;
                else callback();
              },
              final(callback) { callback(options.fault === 'final' ? failure : null); },
              destroy(error, callback) { callback(options.fault === 'close' ? failure : error); },
            });
            setImmediate(() => {
              if (options.fault === 'open') writer.destroy(failure);
              else if (options.fault === 'premature-open') writer.destroy();
              else writer.emit('open');
            });
          }
          // Keep the pre-fix process alive so a missing owner is reported as a bounded test failure.
          writer.on('error', observeError);
          return writer;
        },
      };
      if (name.endsWith('/api-client')) return { BilibiliApiClient: class {
        async resolveRoomInfo() { return { roomId: 123 }; }
        async resolveDanmuInfo() { return { host_list: [{ host: 'fixture.invalid' }], token: 'fixture' }; }
      } };
      if (name.endsWith('/websocket-connection')) return { WebSocketConnection: function () { return connection; } };
      if (name.endsWith('/packet-parser')) return { parseBilibiliPackets: (messages) => messages };
      if (name.endsWith('/utils')) return { cleanText: (value) => String(value || '').trim() };
      return require(name);
    },
  });
  function observeError() {}
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const capture = vm.runInContext('captureEvents', context);
  t.after(async () => {
    if (writer && !writer.closed) {
      const closed = new Promise((resolve) => writer.once('close', resolve));
      writer.destroy();
      await closed;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    outputPath, connection, signals, timers, failure, records,
    run: () => capture({ outputPath, roomId: '123', durationMs: 1000, giftOnly: false }),
    async until(predicate) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail('fixture did not reach the expected state');
    },
    release: () => releaseWrite(),
    fail: () => writer.destroy(failure),
    closePrematurely: () => writer.destroy(),
    get writer() { return writer; },
    assertClean() {
      assert.equal(connection.closeCount, 1);
      assert.equal(connection.eventNames().length, 0);
      assert.equal(signals.listenerCount('SIGINT'), 0);
      assert.equal(timers.size, 0);
      assert.equal(writer.closed, true);
      for (const name of writer.eventNames().filter((name) => typeof name === 'string')) {
        assert.deepEqual(writer.listeners(name), name === 'error' ? [observeError] : [], String(name));
      }
    },
  };
}

async function captureOutcome(promise) {
  let timeout;
  try {
    return await Promise.race([
      promise.then((summary) => ({ summary }), (error) => ({ error })),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({ timeout: true }), 700); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test('capture refuses existing output and reports EEXIST without connecting', async (t) => {
  const f = captureFixture(t);
  fs.writeFileSync(f.outputPath, 'keep me');
  const result = await captureOutcome(f.run());
  assert.equal(result.error?.code, 'EEXIST');
  assert.equal(fs.readFileSync(f.outputPath, 'utf8'), 'keep me');
  assert.equal(f.connection.connectCount, 0);
  f.assertClean();
});

for (const fault of ['open', 'write', 'write-throw', 'final', 'close', 'connect', 'connecting']) {
  test(`capture propagates ${fault} failure and releases its resources`, async (t) => {
    const f = captureFixture(t, { fault, connectPending: fault === 'connecting' });
    const result = captureOutcome(f.run());
    if (fault === 'final' || fault === 'close') {
      await f.until(() => [...f.timers].some((timer) => timer.milliseconds === 1000));
      f.signals.emit('SIGINT');
      f.signals.emit('SIGINT');
    }
    assert.equal((await result).error, f.failure);
    f.assertClean();
  });
}

test('capture cancels its open timeout when interrupted during a pending connection', async (t) => {
  const f = captureFixture(t, { connectPending: true });
  const result = captureOutcome(f.run());
  await f.until(() => f.connection.connectCount === 1);
  f.signals.emit('SIGINT');
  f.signals.emit('SIGINT');
  assert.equal((await result).summary?.reason, 'interrupted');
  f.assertClean();
});

test('capture connection timeout rejects and cleans up without waiting for connect', async (t) => {
  const f = captureFixture(t, { connectPending: true });
  const result = captureOutcome(f.run());
  await f.until(() => f.connection.connectCount === 1);
  [...f.timers].find((timer) => timer.milliseconds === 8000).callback();
  assert.match((await result).error?.message, /连接超时/);
  f.assertClean();
});

test('capture does not hang if output closes without an error before open or drain', async (t) => {
  for (const options of [{ fault: 'premature-open' }, { backpressure: true }]) {
    const f = captureFixture(t, options);
    const result = captureOutcome(f.run());
    if (options.backpressure) {
      await f.until(() => f.records.length === 1);
      f.closePrematurely();
    }
    assert.match((await result).error?.message || '', /closed before finishing/);
    f.assertClean();
  }
});

test('capture respects drain before later records and propagates failure while waiting', async (t) => {
  const f = captureFixture(t, { backpressure: true });
  const result = captureOutcome(f.run());
  await f.until(() => f.records.length === 1);
  f.connection.emit('message', [{ cmd: 'GUARD_BUY', data: { uid: 42 } }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.records.length, 1);
  assert.equal(f.writer.writableLength, Buffer.byteLength(`${JSON.stringify(f.records[0])}\n`));
  f.fail();
  assert.equal((await result).error, f.failure);
  f.assertClean();
});

test('capture drains normally and repeated stop preserves one summary', async (t) => {
  const f = captureFixture(t, { backpressure: true });
  const result = captureOutcome(f.run());
  await f.until(() => f.records.length === 1);
  f.connection.emit('message', [{ cmd: 'GUARD_BUY', data: { uid: 42 } }]);
  f.release();
  await f.until(() => f.records.length === 2);
  f.signals.emit('SIGINT');
  f.connection.emit('close');
  const outcome = await result;
  assert.equal(outcome.summary?.eventCount, 1);
  assert.equal(outcome.summary?.reason, 'interrupted');
  assert.deepEqual(f.records.map((record) => record.type), ['meta', 'event', 'summary']);
  f.assertClean();
});

test('capture writes the existing NDJSON format and cleans up after duration', async (t) => {
  const f = captureFixture(t);
  const result = captureOutcome(f.run());
  await f.until(() => [...f.timers].some((timer) => timer.milliseconds === 1000));
  f.connection.emit('message', [{ cmd: 'GUARD_BUY', data: { uid: 42 } }]);
  const timer = [...f.timers].find((entry) => entry.milliseconds === 1000);
  timer.callback();
  timer.callback();
  assert.equal((await result).summary?.reason, 'duration-elapsed');
  const records = fs.readFileSync(f.outputPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map((record) => record.type), ['meta', 'event', 'summary']);
  assert.equal(records[2].commandCounts.GUARD_BUY, 1);
  f.assertClean();
});
