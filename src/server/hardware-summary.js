'use strict';

const childProcess = require('node:child_process');
const os = require('node:os');
const { cleanText } = require('../shared/utils');

function createHardwareSummaryService(options = {}) {
  let staticSummaryPromise = null;
  const readStatic = options.readStatic || readStaticHardwareSummary;
  const readTemperatures = options.readTemperatures || readHardwareTemperatures;
  const readDisplays = options.readDisplays || readDisplaySummary;

  async function getStaticSummary() {
    if (!staticSummaryPromise) staticSummaryPromise = Promise.resolve().then(readStatic);
    return staticSummaryPromise;
  }

  return {
    async getHardwareSummary(includeTemperatures = false) {
      const [summary, displaySummary] = await Promise.all([getStaticSummary(), readDisplays()]);
      const result = { ...cloneHardwareSummary(summary), ...displaySummary };
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
          temperatureMessage: Number.isFinite(temperature) ? '' : temperatures.gpuMessage || 'NVIDIA GPU 温度不可用',
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
    osName: os.version(),
    osBuild: process.platform === 'win32' ? os.release().split('.')[2] : '',
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
$operatingSystem = $null
$windowsVersion = $null
try { $operatingSystem = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, BuildNumber } catch { $operatingSystem = $null }
try {
  $windowsVersion = Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' |
    Select-Object DisplayVersion, ReleaseId, UBR
} catch { $windowsVersion = $null }
$gpus = @(foreach ($gpu in Get-CimInstance Win32_VideoController) {
  $videoMemoryBytes = $null
  try {
    $driver = Get-ItemPropertyValue -LiteralPath ('HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\' + $gpu.PNPDeviceID) -Name Driver
    $videoMemoryBytes = Get-ItemPropertyValue -LiteralPath ('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\' + $driver) -Name 'HardwareInformation.qwMemorySize'
  } catch {
    # Some drivers only expose the legacy allocation; retain other device data.
  }
  [pscustomobject]@{
    Name = $gpu.Name
    AdapterCompatibility = $gpu.AdapterCompatibility
    AdapterRAM = $gpu.AdapterRAM
    VideoMemoryBytes = $videoMemoryBytes
  }
})
[pscustomobject]@{
  operatingSystem = $operatingSystem
  windowsVersion = $windowsVersion
  cpus = @(Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
  memoryModules = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer, PartNumber, Capacity, Speed)
  gpus = $gpus
} | ConvertTo-Json -Depth 3 -Compress
`;

  return runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    timeout: 5000,
  }).then((stdout) => parseCommandJson(stdout));
}

async function readDisplaySummary() {
  if (process.platform !== 'win32') {
    return { displays: [], displayMessage: '当前系统暂不支持读取显示器信息' };
  }
  // Read the current display mode in pixels; CSS/DIP dimensions lose precision at fractional scaling.
  const command = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LiraDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Mode {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    public ushort SpecVersion, DriverVersion, Size, DriverExtra;
    public uint Fields;
    public int PositionX, PositionY;
    public uint Orientation, FixedOutput;
    public short Color, Duplex, YResolution, TTOption, Collate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string FormName;
    public ushort LogPixels;
    public uint BitsPerPel, PelsWidth, PelsHeight, DisplayFlags, DisplayFrequency;
    public uint ICMMethod, ICMIntent, MediaType, DitherType, Reserved1, Reserved2, PanningWidth, PanningHeight;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct Point { public int X, Y; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDisplaySettingsW(string deviceName, int modeNumber, ref Mode mode);
  [DllImport("user32.dll")]
  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromPoint(Point point, uint flags);
  [DllImport("shcore.dll")]
  public static extern int GetScaleFactorForMonitor(IntPtr monitor, out int scale);
}
'@
$previousContext = [LiraDisplay]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
try {
  $displays = @(foreach ($display in [System.Windows.Forms.Screen]::AllScreens) {
    $mode = New-Object LiraDisplay+Mode
    $mode.Size = [Runtime.InteropServices.Marshal]::SizeOf($mode)
    if (![LiraDisplay]::EnumDisplaySettingsW($display.DeviceName, -1, [ref]$mode)) { continue }
    $point = New-Object LiraDisplay+Point
    $point.X = $mode.PositionX
    $point.Y = $mode.PositionY
    $monitor = [LiraDisplay]::MonitorFromPoint($point, 0)
    $scale = 0
    if ($monitor -eq [IntPtr]::Zero -or [LiraDisplay]::GetScaleFactorForMonitor($monitor, [ref]$scale) -ne 0) { $scale = 0 }
    [pscustomobject]@{
      deviceName = $display.DeviceName
      primary = $display.Primary
      width = $mode.PelsWidth
      height = $mode.PelsHeight
      scalePercent = $scale
      refreshRate = $mode.DisplayFrequency
    }
  })
  [pscustomobject]@{ displays = $displays } | ConvertTo-Json -Depth 3 -Compress
} finally {
  if ($previousContext -ne [IntPtr]::Zero) { [void][LiraDisplay]::SetThreadDpiAwarenessContext($previousContext) }
}
`;
  try {
    const stdout = await runCommand('powershell.exe', ['-NoProfile', '-Command', command]);
    return buildDisplaySummary(parseCommandJson(stdout));
  } catch (_) {
    return { displays: [], displayMessage: '显示器信息暂不可用，可点击开始检测重试' };
  }
}

function buildDisplaySummary(details = {}) {
  const displays = toArray(details.displays)
    .filter((display) => positiveInteger(display.width) && positiveInteger(display.height))
    .map((display, index) => ({
      name: `显示器 ${hardwareText(display.deviceName).match(/DISPLAY(\d+)$/i)?.[1] || index + 1}`,
      primary: display.primary === true,
      width: positiveInteger(display.width),
      height: positiveInteger(display.height),
      scalePercent: positiveInteger(display.scalePercent) || null,
      // Windows uses 0/1 for the driver's default refresh rate, not a measured frequency.
      refreshRate: positiveInteger(display.refreshRate) > 1 ? positiveInteger(display.refreshRate) : null,
    }))
    .sort((left, right) => Number(right.primary) - Number(left.primary));
  return { displays, displayMessage: displays.length ? '' : '未读取到已连接的显示器' };
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
  const gpus = toArray(details.gpus).filter((gpu) => !isVirtualDisplayAdapter(gpu));
  const primaryCpu = cpus[0] || {};
  const logicalCpuCount =
    positiveInteger(primaryCpu.NumberOfLogicalProcessors) || positiveInteger(osSnapshot.logicalCpuCount) || null;
  const physicalCores = cpus.reduce((total, cpu) => total + positiveInteger(cpu.NumberOfCores), 0) || null;
  const buildNumber = hardwareText(details.operatingSystem?.BuildNumber) || hardwareText(osSnapshot.osBuild);
  const revision = details.windowsVersion?.UBR;

  return {
    operatingSystem: {
      name: hardwareText(details.operatingSystem?.Caption) || hardwareText(osSnapshot.osName) || '未知系统',
      displayVersion: hardwareText(details.windowsVersion?.DisplayVersion) || hardwareText(details.windowsVersion?.ReleaseId),
      buildNumber: buildNumber && Number.isInteger(revision) && revision >= 0 ? `${buildNumber}.${revision}` : buildNumber,
    },
    cpu: {
      model: hardwareText(primaryCpu.Name) || hardwareText(osSnapshot.cpuModel) || '未知 CPU',
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
    gpus: gpus.map((gpu) => {
      // AdapterRAM is uint32 and may saturate at 4095 MiB for larger GPUs.
      const legacyMemoryBytes = positiveInteger(gpu.AdapterRAM);
      const videoMemoryBytes = positiveInteger(gpu.VideoMemoryBytes) ||
        (legacyMemoryBytes < 4095 * 1024 * 1024 ? legacyMemoryBytes : 0);
      return {
        name: hardwareText(gpu.Name) || '未知 GPU',
        vendor: hardwareText(gpu.AdapterCompatibility),
        videoMemoryBytes: videoMemoryBytes || null,
        temperatureCelsius: null,
        temperatureMessage: isNvidiaGpu(gpu) ? '点击检测时读取温度' : 'Windows/驱动未提供可靠的 GPU 温度',
      };
    }),
  };
}

function cloneHardwareSummary(summary) {
  return {
    operatingSystem: { ...summary.operatingSystem },
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
  return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
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
  return /\bvirtual\s+(?:display|graphics|video)(?:\s+adapter)?\b/i.test(hardwareText(gpu.name || gpu.Name));
}

module.exports = {
  createHardwareSummaryService,
  buildHardwareSummary,
  buildDisplaySummary,
  readDisplaySummary,
  parseNvidiaSmiOutput,
};
