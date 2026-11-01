'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createDiagnosticTerminal } = require('../../scripts/wesing-diagnostic-terminal');

function diagnosticFixture(options = {}) {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = options.raw === true;
  let paused = options.paused !== false;
  input.isPaused = () => paused;
  input.pause = () => {
    paused = true;
  };
  input.resume = () => {
    paused = false;
  };
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  const processFake = new EventEmitter();
  Object.assign(processFake, {
    stdin: input,
    env: {},
    version: 'fixture',
    platform: 'win32',
  });
  const timers = new Set();
  const calls = [];
  const records = [];
  const logs = [];
  let sample;
  let probeEvent;
  const original = new Error('synthetic original failure');
  const cleanupError = new Error('synthetic cleanup failure');
  const monitor = {
    start() {
      calls.push('monitor.start');
      if (options.fault === 'monitor.start') throw original;
    },
    async stop() {
      calls.push('monitor.stop');
      if (options.fault === 'monitor.stop') throw original;
    },
  };
  const probe = {
    async start() {
      calls.push('probe.start');
      if (options.fault === 'probe.start') throw original;
    },
    async stop() {
      calls.push('probe.stop');
      if (options.finalLog) probeEvent({ event: 'wesing-log-line', line: 'synthetic final line' });
      if (options.fault === 'probe.stop') throw original;
      if (options.cleanupFails) throw cleanupError;
    },
  };
  const writer = {
    async write(record) {
      records.push(record);
      if (options.fault === 'writer.write' && record.event === 'monitor-sample') throw original;
    },
    async close() {
      calls.push('writer.close');
      if (options.fault === 'writer.close') throw original;
      if (options.cleanupFails) throw cleanupError;
    },
  };
  const filename = path.resolve(__dirname, '../../scripts/inspect-wesing-playback.js');
  const context = vm.createContext({
    require(name) {
      if (name === '../src/music/wesing-capture')
        return {
          createPowerShellWeSingMonitor(callback) {
            sample = callback;
            return monitor;
          },
        };
      if (name === './wesing-log-probe')
        return {
          createWeSingLogProbe(cache, callback) {
            probeEvent = callback;
            return probe;
          },
        };
      if (name === './wesing-diagnostic-terminal')
        return {
          createDiagnosticTerminal(callback) {
            return createDiagnosticTerminal(callback, {
              input,
              emitKeypressEvents(stream) {
                stream.on('data', readlineData);
              },
            });
          },
        };
      return require(name);
    },
    module: { exports: {} },
    __dirname: path.dirname(filename),
    Buffer,
    process: processFake,
    console: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        logs.push(message);
      },
    },
    setTimeout(callback) {
      const timer = { callback };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
    },
    fixtures: {
      writer,
    },
  });
  function readlineData() {}
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  vm.runInContext('createJsonlWriter = async () => fixtures.writer;', context);
  const run = vm.runInContext('runDiagnostic', context);
  return {
    calls,
    input,
    processFake,
    timers,
    records,
    original,
    logs,
    run: () =>
      run({
        outputPath: 'synthetic.jsonl',
        cachePath: 'synthetic-cache',
        durationMs: 1000,
      }),
    main() {
      processFake.argv = [
        'node',
        filename,
        '--cache',
        'synthetic-cache',
        '--output',
        'synthetic.jsonl',
        '--duration',
        '1',
      ];
      return vm.runInContext('main', context)();
    },
    sample: () => sample({ title: 'synthetic sample' }),
    async ready() {
      for (let count = 0; count < 30 && timers.size === 0; count += 1)
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(timers.size, 1);
    },
    assertClean() {
      assert.equal(timers.size, 0);
      assert.equal(processFake.listenerCount('SIGINT'), 0);
      assert.equal(input.listenerCount('keypress'), 0);
      assert.equal(input.listenerCount('data'), 0);
      assert.equal(input.isRaw, options.raw === true);
      assert.equal(input.isPaused(), options.paused !== false);
      for (const step of ['monitor.stop', 'probe.stop', 'writer.close']) {
        assert.equal(calls.filter((call) => call === step).length, 1, step);
      }
    },
  };
}

async function diagnosticOutcome(promise) {
  let timeout;
  try {
    return await Promise.race([
      promise.then(
        () => ({ success: true }),
        (error) => ({ error }),
      ),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ timeout: true }), 500);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

for (const fault of ['writer.close', 'probe.stop', 'monitor.stop', 'writer.write', 'probe.start', 'monitor.start']) {
  test(`WeSing diagnostic propagates ${fault} and still cleans every resource`, async () => {
    const f = diagnosticFixture({
      fault,
      cleanupFails: fault !== 'writer.close',
    });
    const outcome = diagnosticOutcome(f.run());
    if (fault !== 'probe.start' && fault !== 'monitor.start') {
      await f.ready();
      if (fault === 'writer.write') f.sample();
      else [...f.timers][0].callback();
    }
    assert.equal((await outcome).error, f.original);
    f.assertClean();
    assert.equal(
      f.logs.some((line) => line.includes('诊断已结束')),
      false,
    );
  });
}

test('WeSing repeated finish calls share success and restore the previous terminal state', async () => {
  const f = diagnosticFixture({ raw: true, paused: false, finalLog: true });
  const outcome = diagnosticOutcome(f.run());
  await f.ready();
  const stop = [...f.timers][0].callback;
  const first = stop();
  const second = stop();
  assert.equal(typeof first?.then, 'function');
  assert.equal(first, second);
  f.input.emit('keypress', 'q', { name: 'q' });
  f.processFake.emit('SIGINT');
  assert.equal((await outcome).success, true);
  f.assertClean();
  assert.equal(f.records.filter((record) => record.event === 'diagnostic-stop').length, 1);
  assert.equal(f.records.at(-2).line, 'synthetic final line');
  assert.deepEqual(f.calls.slice(-3), ['monitor.stop', 'probe.stop', 'writer.close']);
});

test('WeSing main reports finish failure from the CLI configuration path', async () => {
  const f = diagnosticFixture({ fault: 'writer.close' });
  const outcome = diagnosticOutcome(f.main());
  await f.ready();
  f.processFake.emit('SIGINT');
  assert.equal((await outcome).error, f.original);
  f.assertClean();
});

test('WeSing repeated finish calls share the original rejection without unhandled rejections', async () => {
  const f = diagnosticFixture({ fault: 'writer.close' });
  const outcome = diagnosticOutcome(f.run());
  await f.ready();
  const stop = [...f.timers][0].callback;
  const first = stop();
  const second = stop();
  assert.equal(typeof first?.then, 'function');
  assert.equal(first, second);
  await assert.rejects(first, (error) => error === f.original);
  assert.equal((await outcome).error, f.original);
  f.assertClean();
});

test('WeSing JSONL writer preserves the first write failure when file close also fails', async () => {
  const first = new Error('synthetic append failure');
  const later = new Error('synthetic handle close failure');
  let closes = 0;
  const filename = path.resolve(__dirname, '../../scripts/inspect-wesing-playback.js');
  const context = vm.createContext({
    module: { exports: {} },
    __dirname: path.dirname(filename),
    require(name) {
      if (name === 'node:fs')
        return {
          promises: {
            async mkdir() {},
            async open() {
              return {
                async appendFile() {
                  throw first;
                },
                async close() {
                  closes += 1;
                  throw later;
                },
              };
            },
          },
        };
      if (name === '../src/music/wesing-capture') return {};
      return createRequire(filename)(name);
    },
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const writer = await vm.runInContext('createJsonlWriter', context)('synthetic.jsonl');
  await assert.rejects(writer.write({ event: 'synthetic' }), (error) => error === first);
  const closing = writer.close();
  await assert.rejects(closing, (error) => error === first);
  assert.equal(writer.close(), closing);
  assert.equal(closes, 1);
});
