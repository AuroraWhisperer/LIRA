'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildHardwareSummary,
  buildDisplaySummary,
  createHardwareSummaryService,
  parseNvidiaSmiOutput,
} = require('../../src/server/system-metrics');

test('hardware summary exposes useful device data without serial numbers', () => {
  const summary = buildHardwareSummary(
    {
      cpus: [
        {
          Name: '  Example CPU  ',
          NumberOfCores: 8,
          NumberOfLogicalProcessors: 16,
        },
      ],
      memoryModules: [
        {
          Manufacturer: 'Example Memory',
          PartNumber: '  EX-3200-16G  ',
          Capacity: '17179869184',
          Speed: 3200,
          SerialNumber: 'must-not-leak',
        },
      ],
      gpus: [
        {
          Name: 'Example GPU',
          AdapterCompatibility: 'NVIDIA',
          AdapterRAM: '8589934592',
        },
      ],
    },
    {
      cpuModel: 'Fallback CPU',
      logicalCpuCount: 16,
      totalMemoryBytes: 34359738368,
    },
  );

  assert.deepEqual(summary.cpu, {
    model: 'Example CPU',
    physicalCores: 8,
    logicalCores: 16,
    temperatureCelsius: null,
    temperatureMessage: 'Windows 未提供可靠的 CPU 温度',
  });
  assert.equal(summary.memory.totalBytes, 34359738368);
  assert.deepEqual(summary.memory.modules, [
    {
      manufacturer: 'Example Memory',
      model: 'EX-3200-16G',
      capacityBytes: 17179869184,
      speedMhz: 3200,
    },
  ]);
  assert.deepEqual(summary.gpus, [
    {
      name: 'Example GPU',
      vendor: 'NVIDIA',
      videoMemoryBytes: 8589934592,
      temperatureCelsius: null,
      temperatureMessage: '点击检测时读取温度',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /must-not-leak/);
});

test('hardware summary excludes virtual display adapters from the GPU list', () => {
  const summary = buildHardwareSummary({
    gpus: [
      {
        Name: 'MuMu Virtual Display Adapter',
        AdapterCompatibility: 'NetEase',
        AdapterRAM: null,
      },
      {
        Name: 'NVIDIA GeForce RTX 4060 Laptop GPU',
        AdapterCompatibility: 'NVIDIA',
        AdapterRAM: '4294967296',
      },
    ],
  });

  assert.deepEqual(
    summary.gpus.map((gpu) => gpu.name),
    ['NVIDIA GeForce RTX 4060 Laptop GPU'],
  );
});

test('hardware service caches static reads and refreshes temperatures only on request', async () => {
  let staticCalls = 0;
  let temperatureCalls = 0;
  const service = createHardwareSummaryService({
    readStatic: async () => {
      staticCalls += 1;
      return {
        cpu: {
          model: 'CPU',
          physicalCores: 4,
          logicalCores: 8,
          temperatureCelsius: null,
          temperatureMessage: 'unavailable',
        },
        memory: { totalBytes: 16, modules: [] },
        gpus: [
          {
            name: 'GPU',
            vendor: 'NVIDIA',
            videoMemoryBytes: 8,
            temperatureCelsius: null,
            temperatureMessage: '点击检测时读取温度',
          },
        ],
      };
    },
    readTemperatures: async () => {
      temperatureCalls += 1;
      return { gpuTemperatures: [62], gpuMessage: '' };
    },
    readDisplays: async () => ({ displays: [], displayMessage: '' }),
  });

  const initial = await service.getHardwareSummary(false);
  const refreshed = await service.getHardwareSummary(true);
  await service.getHardwareSummary(false);

  assert.equal(staticCalls, 1);
  assert.equal(temperatureCalls, 1);
  assert.equal(initial.gpus[0].temperatureCelsius, null);
  assert.equal(refreshed.gpus[0].temperatureCelsius, 62);
  assert.equal(refreshed.gpus[0].temperatureMessage, '');
});

test('NVIDIA temperature parsing ignores malformed rows', () => {
  assert.deepEqual(parseNvidiaSmiOutput('NVIDIA RTX 4090, 64\r\nBad row\r\nNVIDIA RTX 4080, N/A'), [64, null]);
});

test('display summary preserves physical resolution at fractional scaling and puts the primary screen first', () => {
  const summary = buildDisplaySummary({ displays: [
    { deviceName: '\\\\.\\DISPLAY2', width: 1080, height: 1920, primary: false, scalePercent: 100, refreshRate: 60 },
    { deviceName: '\\\\.\\DISPLAY1', width: 2560, height: 1440, primary: true, scalePercent: 150, refreshRate: 240,
      serialNumber: 'must-not-leak' },
    { width: 0, height: 0 },
  ] });
  assert.deepEqual(summary.displays, [
    { name: '显示器 1', primary: true, width: 2560, height: 1440, scalePercent: 150, refreshRate: 240 },
    { name: '显示器 2', primary: false, width: 1080, height: 1920, scalePercent: 100, refreshRate: 60 },
  ]);
  assert.equal(summary.displayMessage, '');
  assert.doesNotMatch(JSON.stringify(summary), /must-not-leak/);
});

test('unknown display scaling and driver-default refresh rates stay unknown', () => {
  for (const refreshRate of [0, 1, null]) {
    const summary = buildDisplaySummary({ displays: { width: 1920, height: 1080, refreshRate } });
    assert.equal(summary.displays[0].scalePercent, null);
    assert.equal(summary.displays[0].refreshRate, null);
  }
  assert.deepEqual(buildDisplaySummary(), { displays: [], displayMessage: '未读取到已连接的显示器' });
});

test('hardware queries refresh display settings while retaining cached hardware and surviving unavailable displays', async () => {
  let staticCalls = 0;
  let displayCalls = 0;
  let current = { displays: [{ name: '显示器 1', width: 1920, height: 1080 }], displayMessage: '' };
  const service = createHardwareSummaryService({
    readStatic: async () => { staticCalls += 1; return buildHardwareSummary(); },
    readDisplays: async () => { displayCalls += 1; return current; },
    readTemperatures: async () => ({ gpuTemperatures: [], gpuMessage: '' }),
  });
  const first = await service.getHardwareSummary(false);
  current = { displays: [{ name: '显示器 1', width: 2560, height: 1440 }], displayMessage: '' };
  const second = await service.getHardwareSummary(true);
  current = { displays: [], displayMessage: '显示器信息暂不可用' };
  const unavailable = await service.getHardwareSummary(false);
  assert.equal(staticCalls, 1);
  assert.equal(displayCalls, 3);
  assert.equal(first.displays[0].width, 1920);
  assert.equal(second.displays[0].width, 2560);
  assert.equal(unavailable.displays.length, 0);
  assert.equal(unavailable.displayMessage, '显示器信息暂不可用');
  assert.deepEqual(unavailable.cpu, first.cpu);
});
