'use strict';

const { spawn: spawnProcess } = require('node:child_process');
const { parseNeteaseWindowTitle, readNeteaseClientTrack } = require('./netease-client-track');

function createNeteaseClientMonitor(onSample, {
  spawn = spawnProcess,
  readTrack = readNeteaseClientTrack,
  now = Date.now,
} = {}) {
  let child = null;
  let active = false;
  let watchdog = null;
  let retry = null;
  let retries = 0;
  let metadataKey = '';
  let track = null;
  let nextTrackReadAt = 0;

  function clearTimers() {
    clearTimeout(watchdog);
    clearTimeout(retry);
    watchdog = retry = null;
  }

  function retire(running) {
    if (child !== running) return;
    child = null;
    clearTimeout(watchdog);
    running.kill();
    onSample({ error: true });
    scheduleRetry();
  }

  function scheduleRetry() {
    if (!active || retries >= 3) return;
    retry = setTimeout(launch, 500 * 2 ** retries++);
    retry.unref?.();
  }

  function armWatchdog(running) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => retire(running), 15000);
    watchdog.unref?.();
  }

  function enrich(sample) {
    if (!sample || typeof sample !== 'object') return { error: true };
    if (!sample.detected || sample.error) {
      metadataKey = '';
      track = null;
      return sample;
    }
    const parsed = sample.windowTitle ? parseNeteaseWindowTitle(sample.windowTitle) : null;
    const result = { ...sample, ...(parsed || {}) };
    const key = JSON.stringify([result.windowTitle, result.title, result.artists, result.artist, result.durationMs]);
    if (key !== metadataKey) {
      metadataKey = key;
      track = null;
      nextTrackReadAt = 0;
    }
    if (!track && now() >= nextTrackReadAt && result.title) {
      nextTrackReadAt = now() + 1000;
      try { track = readTrack(result); } catch (_) { track = null; }
    }
    if (track) {
      result.title = track.title;
      result.artists = track.artists;
      result.sourceTrackId = track.sourceTrackId;
    }
    return result;
  }

  function launch() {
    if (!active || child) return;
    const encoded = Buffer.from(buildNeteaseClientMonitorScript(), 'utf16le').toString('base64');
    let running;
    try {
      running = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_) {
      onSample({ error: true });
      scheduleRetry();
      return;
    }
    child = running;
    let buffer = '';
    running.stdout.setEncoding('utf8');
    running.stdout.on('data', (chunk) => {
      if (child !== running) return;
      buffer += chunk;
      const rows = buffer.split(/\r?\n/);
      buffer = rows.pop().slice(-16384);
      for (const row of rows) {
        if (!row.trim()) continue;
        let sample;
        try { sample = JSON.parse(row); } catch (_) { onSample({ error: true }); continue; }
        if (sample && typeof sample.detected === 'boolean' && !sample.error) retries = 0;
        armWatchdog(running);
        onSample(enrich(sample));
      }
    });
    running.stderr.resume();
    running.on('error', () => retire(running));
    running.on('exit', () => retire(running));
    armWatchdog(running);
  }

  function start() {
    if (active) return;
    active = true;
    retries = 0;
    launch();
  }

  function stop() {
    active = false;
    clearTimers();
    const running = child;
    child = null;
    running?.kill();
    metadataKey = '';
    track = null;
  }

  return { start, stop };
}

function buildNeteaseClientMonitorScript() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public sealed class NeteasePlaybackWindow {
  public IntPtr Handle;
  public string Title;
}
public static class NeteasePlaybackWindows {
  private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  public static string ReadTitle(IntPtr handle) {
    var text = new StringBuilder(1024);
    GetWindowText(handle, text, text.Capacity);
    return text.ToString();
  }
  public static NeteasePlaybackWindow Find(int[] processIds) {
    var wanted = new HashSet<int>(processIds);
    NeteasePlaybackWindow result = null;
    long largestArea = -1;
    EnumWindows((handle, ignored) => {
      uint processId;
      GetWindowThreadProcessId(handle, out processId);
      if (!wanted.Contains((int)processId)) return true;
      string title = ReadTitle(handle);
      if (!title.Contains(" - ") || title.Contains("MediaPlayer")) return true;
      Rect rect;
      GetWindowRect(handle, out rect);
      long area = (long)Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top);
      if (area > largestArea) { result = new NeteasePlaybackWindow { Handle = handle, Title = title }; largestArea = area; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
Add-Type -TypeDefinition $nativeSource
$manager = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
  } | Select-Object -First 1
  function Wait-MediaResult($operation, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (-not $task.Wait(1500)) { throw 'Media session timeout' }
    return $task.Result
  }
  $manager = Wait-MediaResult ($managerType::RequestAsync()) $managerType
} catch { $manager = $null }
$lastWindow = ''
$nextScanAt = 0
$progressElement = $null
$stateElement = $null
$controlCondition = [System.Windows.Automation.OrCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
)
while ($true) {
  $sample = @{ detected = $false }
  $processes = @()
  try {
    $sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($null -ne $manager) {
      try {
        $session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match '(?i)(^|\\)cloudmusic(\.exe)?$' } | Select-Object -First 1
        if ($null -ne $session) {
          $media = Wait-MediaResult ($session.TryGetMediaPropertiesAsync()) $propertiesType
          $timeline = $session.GetTimelineProperties()
          if ($media.Title -and $timeline.EndTime.TotalMilliseconds -gt 0) {
            $sample = @{ detected = $true; appId = $session.SourceAppUserModelId; title = $media.Title; artist = $media.Artist;
              playbackStatus = $session.GetPlaybackInfo().PlaybackStatus.ToString(); clockSource = 'smtc';
              positionMs = $timeline.Position.TotalMilliseconds; durationMs = $timeline.EndTime.TotalMilliseconds;
              timelineUpdatedAt = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds() }
          }
        }
      } catch { $sample = @{ detected = $false } }
    }
    if (-not $sample.detected) {
      $processes = @(Get-Process -Name cloudmusic -ErrorAction SilentlyContinue)
      if ($processes.Count -gt 0) { $sample = @{ detected = $true; playbackStatus = 'Unknown'; clockSource = 'uia' } }
      $window = [NeteasePlaybackWindows]::Find([int[]]@($processes | ForEach-Object { [int]$_.Id }))
      if ($null -ne $window) {
        $windowKey = $window.Handle.ToInt64().ToString() + ':' + $window.Title
        if ($windowKey -ne $lastWindow) {
          $lastWindow = $windowKey
          $progressElement = $null
          $stateElement = $null
          $nextScanAt = $sampledAt + 1500
        }
        $sample.windowTitle = $window.Title
        if ($sampledAt -ge $nextScanAt) {
          $nextScanAt = $sampledAt + 2000
          $progressElement = $null
          $stateElement = $null
          $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
          $controls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $controlCondition)
          $buttons = @()
          for ($index = 0; $index -lt [Math]::Min($controls.Count, 2000); $index++) {
            $control = $controls.Item($index)
            $name = [string]$control.Current.Name
            if ($name -match '^\s*\d{1,3}:\d{2}\s*[/|]\s*\d{1,3}:\d{2}\s*$') { $progressElement = $control }
            if ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $name -match '^(暂停|播放|Pause|Play)(\s*\([^)]*\))?$') { $buttons += $control }
          }
          if ($null -ne $progressElement) {
            $progressY = $progressElement.Current.BoundingRectangle.Top
            $stateElement = $buttons | Where-Object { [Math]::Abs($_.Current.BoundingRectangle.Top - $progressY) -lt 100 } |
              Sort-Object { [Math]::Abs($_.Current.BoundingRectangle.Top - $progressY) } | Select-Object -First 1
          }
        }
        if ($null -ne $stateElement) {
          $name = [string]$stateElement.Current.Name
          if ($name -match '^(暂停|Pause)') { $sample.playbackStatus = 'Playing' }
          elseif ($name -match '^(播放|Play)') { $sample.playbackStatus = 'Paused' }
        }
        if ($null -ne $progressElement -and $progressElement.Current.Name -match '^\s*(\d{1,3}):(\d{2})\s*[/|]\s*(\d{1,3}):(\d{2})\s*$') {
          if ([int]$matches[2] -lt 60 -and [int]$matches[4] -lt 60) {
            $sample.positionMs = (([int]$matches[1] * 60) + [int]$matches[2]) * 1000
            $sample.durationMs = (([int]$matches[3] * 60) + [int]$matches[4]) * 1000
            $sample.timelineUpdatedAt = $sampledAt
          }
        }
        if ([NeteasePlaybackWindows]::ReadTitle($window.Handle) -ne $window.Title) {
          $sample = @{ detected = $true; playbackStatus = 'Changing'; clockSource = 'uia' }
        }
      } else { $lastWindow = ''; $progressElement = $null; $stateElement = $null }
    }
  } catch { $sample = @{ error = $true } }
  finally { foreach ($process in $processes) { $process.Dispose() } }
  Write-Output ($sample | ConvertTo-Json -Compress)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}
`;
}

module.exports = { createNeteaseClientMonitor, buildNeteaseClientMonitorScript };
