'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const test = require('node:test');

const {
  buildHardwareSummary,
  buildDisplaySummary,
  createHardwareSummaryService,
} = require('../../src/server/hardware-summary');
const { sampleWindowsGpuMetrics } = require('../../src/server/system-metrics');

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

test('hardware service caches static reads and refreshes temperatures only on request', async () => {
  let staticCalls = 0;
  let temperatureCalls = 0;
  const service = createHardwareSummaryService({
    readStatic: async () => {
      staticCalls += 1;
      return buildHardwareSummary({ gpus: [{ Name: 'GPU', AdapterCompatibility: 'NVIDIA' }] });
    },
    readTemperatures: async () => {
      temperatureCalls += 1;
      return { gpuTemperatures: [62], gpuMessage: '' };
    },
    readDisplays: async () => ({ displays: [], displayMessage: '' }),
  });

  const initial = await service.getHardwareSummary(false);
  initial.gpus[0].name = 'changed by consumer';
  const refreshed = await service.getHardwareSummary(true);
  await service.getHardwareSummary(false);

  assert.equal(staticCalls, 1);
  assert.equal(temperatureCalls, 1);
  assert.equal(refreshed.gpus[0].name, 'GPU');
  assert.equal(initial.gpus[0].temperatureCelsius, null);
  assert.equal(refreshed.gpus[0].temperatureCelsius, 62);
});
