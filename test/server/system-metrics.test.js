'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const os = require('node:os');
const test = require('node:test');

const {
  buildHardwareSummary,
  buildDisplaySummary,
  createHardwareSummaryService,
} = require('../../src/server/hardware-summary');
const { getSystemMetrics, sampleWindowsGpuMetrics } = require('../../src/server/system-metrics');

function mockWindowsCommand(t, callback) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', platform));
  t.mock.method(childProcess, 'execFile', callback);
}

test('GPU command timeout stays unavailable instead of reporting zero load', async (t) => {
  mockWindowsCommand(t, (file, args, options, callback) => {
    assert.ok(options.timeout <= 20000, 'GPU sampling remains bounded');
    callback(Object.assign(new Error('timed out'), { killed: true }), '');
  });
  const result = await sampleWindowsGpuMetrics(5000);
  assert.equal(result.available, false);
  assert.equal(result.totalPercent, null);
});

test('the CPU sample window follows elapsed time across a wall clock rollback', async (t) => {
  const start = Date.UTC(2026, 0, 1);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  let elapsed = 0;
  t.mock.method(process.hrtime, 'bigint', () => BigInt(elapsed) * 1000000n);
  t.mock.method(os, 'cpus', () => [{ times: { user: elapsed * 0.6, idle: elapsed * 0.4 } }]);
  t.mock.method(os, 'totalmem', () => 1024);
  t.mock.method(os, 'freemem', () => 512);
  t.mock.method(process, 'cpuUsage', () => ({ user: 0, system: 0 }));
  t.mock.method(process, 'memoryUsage', () => ({ rss: 32, heapUsed: 16 }));
  mockWindowsCommand(t, (_file, _args, _options, done) => done(new Error('no GPU counter')));
  const pending = getSystemMetrics(5000);
  elapsed = 5000;
  t.mock.timers.tick(elapsed);
  t.mock.timers.setTime(start + elapsed - 60000);
  const sample = await pending;
  assert.equal(sample.windowMs, 5000);
  assert.equal(Date.parse(sample.sampledAt), start - 55000);
  assert.equal(sample.system.cpuPercent, 60);
});

test('logical CPU count covers all sockets and falls back to the OS total for incomplete inventory', () => {
  const cpu = { NumberOfCores: 8, NumberOfLogicalProcessors: 16 };
  assert.equal(buildHardwareSummary({ cpus: [cpu, cpu] }).cpu.logicalCores, 32);
  assert.equal(buildHardwareSummary({ cpus: [cpu, {}] }, { logicalCpuCount: 24 }).cpu.logicalCores, 24);
});

test('hardware and display summaries never expose serial numbers or product IDs', () => {
  const summary = buildHardwareSummary({
    memoryModules: [{ PartNumber: 'EX-3200-16G', Capacity: '17179869184', SerialNumber: 'must-not-leak' }],
    operatingSystem: { Caption: 'Microsoft Windows 11', BuildNumber: '26200', SerialNumber: 'must-not-leak' },
    windowsVersion: { DisplayVersion: '25H2', UBR: 6899, ProductId: 'must-not-leak' },
  });
  assert.equal(summary.memory.modules[0].capacityBytes, 17179869184);
  assert.doesNotMatch(JSON.stringify(summary), /must-not-leak/);
  const displays = buildDisplaySummary({ displays: [{ width: 2560, height: 1440, primary: true, serialNumber: 'must-not-leak' }] });
  assert.equal(displays.displays[0].width, 2560);
  assert.doesNotMatch(JSON.stringify(displays), /must-not-leak/);
});

test('hardware service caches inventory and matches requested temperatures to unique GPU names', async (t) => {
  let staticCalls = 0;
  let temperatureCalls = 0;
  const models = ['RTX 3060', 'RTX 4070', 'Twin', 'Twin', 'Ambiguous', 'Missing'];
  mockWindowsCommand(t, (file, _args, _options, done) => {
    assert.equal(file, 'nvidia-smi.exe');
    temperatureCalls++;
    done(null, 'RTX 4070, 39\nTwin, 63\nAmbiguous, 61\nAmbiguous, 65\nrtx 3060, 77\n');
  });
  const service = createHardwareSummaryService({
    readStatic: async () => {
      staticCalls += 1;
      return buildHardwareSummary({ gpus: models.map(Name => ({ Name, AdapterCompatibility: 'NVIDIA' })) });
    },
    readDisplays: async () => ({ displays: [], displayMessage: '' }),
  });

  const initial = await service.getHardwareSummary(false);
  initial.gpus[0].name = 'changed by consumer';
  const refreshed = await service.getHardwareSummary(true);
  await service.getHardwareSummary(false);

  assert.equal(staticCalls, 1);
  assert.equal(temperatureCalls, 1);
  assert.equal(refreshed.gpus[0].name, models[0]);
  assert.equal(initial.gpus[0].temperatureCelsius, null);
  assert.deepEqual(refreshed.gpus.map(gpu => gpu.temperatureCelsius), [77, 39, null, null, null, null]);
});

test('an inventory timeout returns the OS fallback and later requests share a successful retry', async (t) => {
  let devices = 0;
  let temperatures = 0;
  t.mock.method(os, 'cpus', () => [{ model: '合成 CPU' }]);
  t.mock.method(os, 'totalmem', () => 8192);
  t.mock.method(os, 'version', () => '合成系统');
  t.mock.method(os, 'release', () => '10.0.12345');
  mockWindowsCommand(t, (file, _args, _options, done) => {
    if (file === 'nvidia-smi.exe') {
      temperatures++;
      return done(null, 'Fixture NVIDIA, 46');
    }
    assert.equal(file, 'powershell.exe');
    if (++devices === 1) return done(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    done(null, JSON.stringify({ gpus: [{ Name: 'Fixture NVIDIA', AdapterCompatibility: 'NVIDIA' }] }));
  });
  const service = createHardwareSummaryService({ readDisplays: async () => ({ displays: [] }) });
  const initial = await service.getHardwareSummary();
  assert.equal(initial.cpu.model, '合成 CPU');
  assert.equal(initial.gpus.length, 0);
  const [recovered] = await Promise.all([service.getHardwareSummary(true), service.getHardwareSummary()]);
  assert.equal(recovered.gpus[0].name, 'Fixture NVIDIA');
  assert.equal(recovered.gpus[0].temperatureCelsius, 46);
  await service.getHardwareSummary(true);
  assert.deepEqual([devices, temperatures], [2, 2]);
});
