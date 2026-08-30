'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildHardwareSummary,
  createHardwareSummaryService,
  parseNvidiaSmiOutput,
} = require('../src/server/system-metrics');

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
  assert.deepEqual(
    parseNvidiaSmiOutput(
      'NVIDIA RTX 4090, 64\r\nBad row\r\nNVIDIA RTX 4080, N/A',
    ),
    [64, null],
  );
});
