'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const {
  markerForKey,
  parseArguments,
  parseStartKSongLine,
  readRunningCachePath,
  summarizeSample,
} = require('../scripts/inspect-wesing-playback');

test('WeSing diagnostic parses cache, output, and duration options', () => {
  const result = parseArguments(
    [
      '--cache',
      'C:\\Music\\WeSingCache',
      '--output',
      'D:\\Logs\\wesing.jsonl',
      '--duration',
      '90',
    ],
    {
      environment: { APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming' },
      projectRoot: 'D:\\Work\\Live',
      now: new Date('2026-08-13T10:00:00.000Z'),
    },
  );

  assert.equal(result.cachePath, path.resolve('C:\\Music\\WeSingCache'));
  assert.equal(result.outputPath, path.resolve('D:\\Logs\\wesing.jsonl'));
  assert.equal(result.durationMs, 90000);
  assert.equal(result.help, false);
  assert.equal(result.cachePathFromArgument, true);
});

test('WeSing diagnostic rejects invalid duration and unknown options', () => {
  assert.throws(() => parseArguments(['--duration', '0']), /1 到 3600/);
  assert.throws(() => parseArguments(['--unknown']), /未知参数/);
});

test('WeSing diagnostic maps operation markers', () => {
  assert.equal(markerForKey('2'), '点击暂停');
  assert.equal(markerForKey('5'), '重新进入同一首歌 K 歌');
  assert.equal(markerForKey('x'), null);
});

test('WeSing diagnostic reads the configured cache path from the running local app', async () => {
  const requests = [];
  const files = new Map([
    [
      'D:\\Work\\Live\\data\\.server-runtime.json',
      '{"port":3000,"host":"127.0.0.1"}',
    ],
    ['D:\\Work\\Live\\data\\.session-token', 'local-token'],
  ]);
  const cachePath = await readRunningCachePath({
    projectRoot: 'D:\\Work\\Live',
    environment: {},
    async readFile(filePath) {
      return files.get(filePath);
    },
    async fetchImpl(url, options) {
      requests.push({ url, authorization: options.headers.Authorization });
      return {
        ok: true,
        async json() {
          return { data: { cachePath: 'D:\\WeSingCache' } };
        },
      };
    },
  });

  assert.equal(cachePath, 'D:\\WeSingCache');
  assert.deepEqual(requests, [
    {
      url: 'http://127.0.0.1:3000/api/music/wesing/status',
      authorization: 'Bearer local-token',
    },
  ]);
});

test('WeSing diagnostic extracts StartKSong identity from native log rows', () => {
  const parsed = parseStartKSongLine(
    'event "StartKSong" payload {"mid":"0042","songname":"失眠飞行"}',
  );
  assert.deepEqual(parsed, { mid: '0042', songName: '失眠飞行' });
  assert.equal(parseStartKSongLine('ordinary row'), null);
});

test('WeSing diagnostic summarizes samples without copying UIA controls', () => {
  const summary = summarizeSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    audioActive: true,
    audioPeak: 0.125,
    windowHandle: 123,
    processIds: [10, 11],
    controls: [{ name: '暂停' }],
  });

  assert.equal(summary.audioPeak, 0.125);
  assert.equal(summary.windowHandle, 123);
  assert.equal(summary.controlCount, 1);
  assert.equal('controls' in summary, false);
  assert.equal(summarizeSample(null).detected, false);
});

function diagnosticFixture(options = {}) {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = options.raw === true;
  let paused = options.paused !== false;
  input.isPaused = () => paused;
  input.pause = () => { paused = true; };
  input.resume = () => { paused = false; };
  input.setRawMode = (value) => { input.isRaw = value; };
  const processFake = new EventEmitter();
  Object.assign(processFake, { stdin: input, env: {}, version: 'fixture', platform: 'win32' });
  const timers = new Set();
  const calls = [];
  const records = [];
  const logs = [];
  let sample;
  let probeEvent;
  const original = new Error('synthetic original failure');
  const cleanupError = new Error('synthetic cleanup failure');
  const monitor = {
    start() { calls.push('monitor.start'); if (options.fault === 'monitor.start') throw original; },
    async stop() { calls.push('monitor.stop'); if (options.fault === 'monitor.stop') throw original; },
  };
  const probe = {
    async start() { calls.push('probe.start'); if (options.fault === 'probe.start') throw original; },
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
  const filename = path.resolve(__dirname, '../scripts/inspect-wesing-playback.js');
  const context = vm.createContext({
    require(name) {
      if (name === '../src/music/wesing-capture') return {
        createPowerShellWeSingMonitor(callback) { sample = callback; return monitor; },
      };
      if (name === 'node:readline') return {
        emitKeypressEvents(stream) { stream.on('data', readlineData); },
      };
      return require(name);
    },
    module: { exports: {} }, __dirname: path.dirname(filename), Buffer,
    process: processFake,
    console: { log(message) { logs.push(message); }, error(message) { logs.push(message); } },
    setTimeout(callback) { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    fixtures: { writer, createProbe(cache, callback) { probeEvent = callback; return probe; } },
  });
  function readlineData() {}
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  vm.runInContext('createJsonlWriter = async () => fixtures.writer; createWeSingLogProbe = fixtures.createProbe;', context);
  const run = vm.runInContext('runDiagnostic', context);
  return {
    calls, input, processFake, timers, records, original, logs,
    run: () => run({ outputPath: 'synthetic.jsonl', cachePath: 'synthetic-cache', durationMs: 1000 }),
    main() {
      processFake.argv = ['node', filename, '--cache', 'synthetic-cache', '--output', 'synthetic.jsonl', '--duration', '1'];
      return vm.runInContext('main', context)();
    },
    sample: () => sample({ title: 'synthetic sample' }),
    async ready() {
      for (let count = 0; count < 30 && timers.size === 0; count += 1) await new Promise((resolve) => setImmediate(resolve));
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
      promise.then(() => ({ success: true }), (error) => ({ error })),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({ timeout: true }), 500); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

for (const fault of ['writer.close', 'probe.stop', 'monitor.stop', 'writer.write', 'probe.start', 'monitor.start']) {
  test(`WeSing diagnostic propagates ${fault} and still cleans every resource`, async () => {
    const f = diagnosticFixture({ fault, cleanupFails: fault !== 'writer.close' });
    const outcome = diagnosticOutcome(f.run());
    if (fault !== 'probe.start' && fault !== 'monitor.start') {
      await f.ready();
      if (fault === 'writer.write') f.sample();
      else [...f.timers][0].callback();
    }
    assert.equal((await outcome).error, f.original);
    f.assertClean();
    assert.equal(f.logs.some((line) => line.includes('诊断已结束')), false);
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
  const filename = path.resolve(__dirname, '../scripts/inspect-wesing-playback.js');
  const context = vm.createContext({
    module: { exports: {} }, __dirname: path.dirname(filename),
    require(name) {
      if (name === 'node:fs') return { promises: {
        async mkdir() {},
        async open() { return {
          async appendFile() { throw first; },
          async close() { closes += 1; throw later; },
        }; },
      } };
      if (name === '../src/music/wesing-capture') return {};
      return require(name);
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
