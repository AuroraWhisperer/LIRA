// 编写人：Aurora
// 服务进程与主机 CPU、内存、GPU 指标采样。
'use strict';

const childProcess = require('node:child_process');
const os = require('node:os');
const { cleanText, clampPercent, now, sleep } = require('../shared/utils');

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
  const processElapsedMicros = Number(process.hrtime.bigint() - processTimeStart) / 1000;
  const cpuCount = Math.max(os.cpus().length, 1);
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const processMemory = process.memoryUsage();
  const gpu = await gpuPromise;

  return {
    sampledAt: now(),
    windowMs: Date.now() - startedAt,
    system: {
      cpuPercent: calculateSystemCpuPercent(cpuStart, cpuEnd),
      memoryPercent: totalMemory > 0 ? clampPercent(((totalMemory - freeMemory) / totalMemory) * 100) : null,
      memoryUsedBytes: totalMemory - freeMemory,
      memoryTotalBytes: totalMemory,
      gpuPercent: gpu.totalPercent,
      gpuAvailable: gpu.available,
      gpuMessage: gpu.message
    },
    process: {
      pid: process.pid,
      cpuPercent: processElapsedMicros > 0
        ? clampPercent(((processCpuDelta.user + processCpuDelta.system) / (processElapsedMicros * cpuCount)) * 100)
        : null,
      memoryPercent: totalMemory > 0 ? clampPercent((processMemory.rss / totalMemory) * 100) : null,
      memoryRssBytes: processMemory.rss,
      memoryHeapUsedBytes: processMemory.heapUsed,
      uptimeSeconds: Math.floor(process.uptime()),
      gpuPercent: gpu.processPercent,
      gpuAvailable: gpu.available,
      gpuMessage: gpu.message
    }
  };
}

function readSystemCpuSnapshot() {
  return os.cpus().reduce((snapshot, cpu) => {
    const times = cpu.times || {};
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return {
      idle: snapshot.idle + (times.idle || 0),
      total: snapshot.total + total
    };
  }, { idle: 0, total: 0 });
}

function calculateSystemCpuPercent(start, end) {
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (totalDelta <= 0) return null;
  return clampPercent((1 - idleDelta / totalDelta) * 100);
}

function sampleWindowsGpuMetrics(windowMs) {
  if (process.platform !== 'win32') {
    return Promise.resolve({
      available: false,
      totalPercent: null,
      processPercent: null,
      message: '当前系统不支持 GPU 计数器'
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
    childProcess.execFile('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command
    ], {
      windowsHide: true,
      timeout: (sampleCount + 3) * 1000,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        resolve({
          available: false,
          totalPercent: null,
          processPercent: null,
          message: 'GPU 计数器不可用'
        });
        return;
      }

      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
        const payload = JSON.parse(line || '{}');
        resolve({
          available: payload.available === true,
          totalPercent: Number.isFinite(Number(payload.totalPercent)) ? clampPercent(Number(payload.totalPercent)) : null,
          processPercent: Number.isFinite(Number(payload.processPercent)) ? clampPercent(Number(payload.processPercent)) : null,
          message: cleanText(payload.message) || ''
        });
      } catch (_) {
        resolve({
          available: false,
          totalPercent: null,
          processPercent: null,
          message: 'GPU 数据解析失败'
        });
      }
    });
  });
}

module.exports = {
  getSystemMetrics,
  readSystemCpuSnapshot,
  calculateSystemCpuPercent,
  sampleWindowsGpuMetrics
};
