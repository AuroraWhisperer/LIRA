// 编写人：Aurora
// 服务进程与主机 CPU、内存、GPU 指标采样。
'use strict';

const childProcess = require('node:child_process');
const os = require('node:os');
const { cleanText, clampPercent, now, sleep } = require('../shared/utils');

const GPU_SAMPLE_GRACE_MS = 250;

const hardwareSummaryService = createHardwareSummaryService();

async function getSystemMetrics(rawWindowMs = 5000) {
  const windowMs = Math.min(Math.max(Number(rawWindowMs) || 5000, 1000), 10000);
  const startedAt = Date.now();
  const cpuStart = readSystemCpuSnapshot();
  const processCpuStart = process.cpuUsage();
  const processTimeStart = process.hrtime.bigint();
  const gpuPromise = sampleWindowsGpuMetrics(windowMs);

  await sleep(windowMs);

  const cpuEnd = readSystemCpuSnapshot();
  const processCpuDelta = process.cpuUsage(processCpuStart);
  const processElapsedMicros =
    Number(process.hrtime.bigint() - processTimeStart) / 1000;
  const cpuCount = Math.max(os.cpus().length, 1);
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const processMemory = process.memoryUsage();
  // Windows' performance-counter process can finish a little after the exact
  // sample window. Do not hold the whole metrics response for that tail; the
  // next sample can retry GPU data without delaying CPU/memory results.
  const gpu = await Promise.race([
    gpuPromise,
    sleep(GPU_SAMPLE_GRACE_MS).then(() => ({
      available: false,
      totalPercent: null,
      processPercent: null,
      message: 'GPU 计数器采样超时',
    })),
  ]);

  return {
    sampledAt: now(),
    windowMs: Date.now() - startedAt,
    system: {
      cpuPercent: calculateSystemCpuPercent(cpuStart, cpuEnd),
      memoryPercent:
        totalMemory > 0
          ? clampPercent(((totalMemory - freeMemory) / totalMemory) * 100)
          : null,
      memoryUsedBytes: totalMemory - freeMemory,
      memoryTotalBytes: totalMemory,
      gpuPercent: gpu.totalPercent,
      gpuAvailable: gpu.available,
      gpuMessage: gpu.message,
    },
    process: {
      pid: process.pid,
      cpuPercent:
        processElapsedMicros > 0
          ? clampPercent(
              ((processCpuDelta.user + processCpuDelta.system) /
                (processElapsedMicros * cpuCount)) *
                100,
            )
          : null,
      memoryPercent:
        totalMemory > 0
          ? clampPercent((processMemory.rss / totalMemory) * 100)
          : null,
      memoryRssBytes: processMemory.rss,
      memoryHeapUsedBytes: processMemory.heapUsed,
      uptimeSeconds: Math.floor(process.uptime()),
      gpuPercent: gpu.processPercent,
      gpuAvailable: gpu.available,
      gpuMessage: gpu.message,
    },
  };
}

function readSystemCpuSnapshot() {
  return os.cpus().reduce(
    (snapshot, cpu) => {
      const times = cpu.times || {};
      const total = Object.values(times).reduce((sum, value) => sum + value, 0);
      return {
        idle: snapshot.idle + (times.idle || 0),
        total: snapshot.total + total,
      };
    },
    { idle: 0, total: 0 },
  );
}

function calculateSystemCpuPercent(start, end) {
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (totalDelta <= 0) return null;
  return clampPercent((1 - idleDelta / totalDelta) * 100);
}

function getHardwareSummary(includeTemperatures = false) {
  return hardwareSummaryService.getHardwareSummary(includeTemperatures);
}

function createHardwareSummaryService(options = {}) {
  let staticSummaryPromise = null;
  const readStatic = options.readStatic || readStaticHardwareSummary;
  const readTemperatures = options.readTemperatures || readHardwareTemperatures;

  async function getStaticSummary() {
    if (!staticSummaryPromise)
      staticSummaryPromise = Promise.resolve().then(readStatic);
    return staticSummaryPromise;
  }

  return {
    async getHardwareSummary(includeTemperatures = false) {
      const summary = await getStaticSummary();
      const result = cloneHardwareSummary(summary);
      if (!includeTemperatures) return result;

      const temperatures = await readTemperatures(result.gpus);
      let temperatureIndex = 0;
      result.gpus = result.gpus.map((gpu) => {
        if (!isNvidiaGpu(gpu)) return gpu;
        const temperature = temperatures.gpuTemperatures[temperatureIndex];
        temperatureIndex += 1;
        return {
          ...gpu,
          temperatureCelsius: Number.isFinite(temperature) ? temperature : null,
          temperatureMessage: Number.isFinite(temperature)
            ? ''
            : temperatures.gpuMessage || 'NVIDIA GPU 温度不可用',
        };
      });
      return result;
    },
  };
}

async function readStaticHardwareSummary() {
  const osSnapshot = {
    cpuModel: os.cpus()[0]?.model || '',
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
  if (process.platform !== 'win32') {
    return buildHardwareSummary({}, osSnapshot);
  }

  try {
    return buildHardwareSummary(await readWindowsDeviceDetails(), osSnapshot);
  } catch (_) {
    return buildHardwareSummary({}, osSnapshot);
  }
}

function readWindowsDeviceDetails() {
  const command = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[pscustomobject]@{
  cpus = @(Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
  memoryModules = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer, PartNumber, Capacity, Speed)
  gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, AdapterCompatibility, AdapterRAM)
} | ConvertTo-Json -Depth 3 -Compress
`;

  return runCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeout: 5000 },
  ).then((stdout) => parseCommandJson(stdout));
}

async function readHardwareTemperatures(gpus) {
  const nvidiaGpus = gpus.filter(isNvidiaGpu);
  if (!nvidiaGpus.length) return { gpuTemperatures: [], gpuMessage: '' };

  try {
    const stdout = await runCommand(
      'nvidia-smi.exe',
      ['--query-gpu=name,temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 3000 },
    );
    return { gpuTemperatures: parseNvidiaSmiOutput(stdout), gpuMessage: '' };
  } catch (_) {
    return { gpuTemperatures: [], gpuMessage: 'NVIDIA GPU 温度不可用' };
  }
}

function buildHardwareSummary(details = {}, osSnapshot = {}) {
  const cpus = toArray(details.cpus);
  const memoryModules = toArray(details.memoryModules);
  const gpus = toArray(details.gpus).filter(
    (gpu) => !isVirtualDisplayAdapter(gpu),
  );
  const primaryCpu = cpus[0] || {};
  const logicalCpuCount =
    positiveInteger(primaryCpu.NumberOfLogicalProcessors) ||
    positiveInteger(osSnapshot.logicalCpuCount) ||
    null;
  const physicalCores =
    cpus.reduce(
      (total, cpu) => total + positiveInteger(cpu.NumberOfCores),
      0,
    ) || null;

  return {
    cpu: {
      model:
        hardwareText(primaryCpu.Name) ||
        hardwareText(osSnapshot.cpuModel) ||
        '未知 CPU',
      physicalCores,
      logicalCores: logicalCpuCount,
      temperatureCelsius: null,
      temperatureMessage: 'Windows 未提供可靠的 CPU 温度',
    },
    memory: {
      totalBytes: positiveInteger(osSnapshot.totalMemoryBytes) || null,
      modules: memoryModules.map((module) => ({
        manufacturer: hardwareText(module.Manufacturer) || '未知厂商',
        model: hardwareText(module.PartNumber) || '未知型号',
        capacityBytes: positiveInteger(module.Capacity) || null,
        speedMhz: positiveInteger(module.Speed) || null,
      })),
      temperatureCelsius: null,
      temperatureMessage: 'Windows 未提供可靠的内存温度',
    },
    gpus: gpus.map((gpu) => ({
      name: hardwareText(gpu.Name) || '未知 GPU',
      vendor: hardwareText(gpu.AdapterCompatibility),
      videoMemoryBytes: positiveInteger(gpu.AdapterRAM) || null,
      temperatureCelsius: null,
      temperatureMessage: isNvidiaGpu(gpu)
        ? '点击检测时读取温度'
        : 'Windows/驱动未提供可靠的 GPU 温度',
    })),
  };
}

function cloneHardwareSummary(summary) {
  return {
    cpu: { ...summary.cpu },
    memory: {
      ...summary.memory,
      modules: summary.memory.modules.map((module) => ({ ...module })),
    },
    gpus: summary.gpus.map((gpu) => ({ ...gpu })),
  };
}

function parseCommandJson(stdout) {
  const line = String(stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();
  const parsed = JSON.parse(line || '{}');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function parseNvidiaSmiOutput(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(',', 2);
      if (parts.length < 2) return [];
      const rawTemperature = parts[1];
      const temperature = Number(String(rawTemperature).trim());
      return [Number.isFinite(temperature) ? temperature : null];
    });
}

function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: options.timeout || 5000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function toArray(value) {
  return Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value]
      : [];
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function hardwareText(value) {
  return cleanText(value).slice(0, 200);
}

function isNvidiaGpu(gpu) {
  return /nvidia/i.test(hardwareText(gpu.vendor || gpu.AdapterCompatibility));
}

function isVirtualDisplayAdapter(gpu) {
  return /\bvirtual\s+(?:display|graphics|video)(?:\s+adapter)?\b/i.test(
    hardwareText(gpu.name || gpu.Name),
  );
}

function sampleWindowsGpuMetrics(windowMs) {
  if (process.platform !== 'win32') {
    return Promise.resolve({
      available: false,
      totalPercent: null,
      processPercent: null,
      message: '当前系统不支持 GPU 计数器',
    });
  }

  const sampleCount = Math.min(Math.max(Math.round(windowMs / 1000), 1), 10);
  const targetPid = Number(process.pid);
  const command = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$target = 'pid_${targetPid}_'
$sets = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${sampleCount} -ErrorAction Stop
$total = 0.0
$process = 0.0
$count = 0
foreach ($set in @($sets)) {
  $setTotal = 0.0
  $setProcess = 0.0
  foreach ($sample in $set.CounterSamples) {
    $value = [double]$sample.CookedValue
    if ($value -gt 0) {
      $setTotal += $value
      $name = ([string]$sample.InstanceName).ToLowerInvariant()
      if ($name.Contains($target)) {
        $setProcess += $value
      }
    }
  }
  $total += [Math]::Min($setTotal, 100)
  $process += [Math]::Min($setProcess, 100)
  $count += 1
}
if ($count -lt 1) { $count = 1 }
[pscustomobject]@{
  available = $true
  totalPercent = [Math]::Round($total / $count, 1)
  processPercent = [Math]::Round($process / $count, 1)
  message = ''
} | ConvertTo-Json -Compress
`;

  return new Promise((resolve) => {
    childProcess.execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        windowsHide: true,
        timeout: (sampleCount + 3) * 1000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve({
            available: false,
            totalPercent: null,
            processPercent: null,
            message: 'GPU 计数器不可用',
          });
          return;
        }

        try {
          const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
          const payload = JSON.parse(line || '{}');
          resolve({
            available: payload.available === true,
            totalPercent: Number.isFinite(Number(payload.totalPercent))
              ? clampPercent(Number(payload.totalPercent))
              : null,
            processPercent: Number.isFinite(Number(payload.processPercent))
              ? clampPercent(Number(payload.processPercent))
              : null,
            message: cleanText(payload.message) || '',
          });
        } catch (_) {
          resolve({
            available: false,
            totalPercent: null,
            processPercent: null,
            message: 'GPU 数据解析失败',
          });
        }
      },
    );
  });
}

module.exports = {
  getSystemMetrics,
  getHardwareSummary,
  createHardwareSummaryService,
  buildHardwareSummary,
  parseNvidiaSmiOutput,
  readSystemCpuSnapshot,
  calculateSystemCpuPercent,
  sampleWindowsGpuMetrics,
};
