'use strict';

const { spawn: spawnProcess } = require('node:child_process');

function createQQClientMonitor(onSample, { spawn = spawnProcess } = {}) {
  let child = null;
  let active = false;
  let retryTimer = null;
  let retries = 0;

  function retry() {
    onSample({ error: true });
    if (!active || retries >= 3) return;
    const delay = 500 * (2 ** retries++);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      launch();
    }, delay);
    retryTimer.unref?.();
  }

  function launch() {
    if (!active || child) return;
    const encoded = Buffer.from(buildQQClientMonitorScript(), 'utf16le').toString('base64');
    let running;
    try {
      running = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_) {
      retry();
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
        if (child !== running) break;
        if (!row.trim()) continue;
        let sample;
        try { sample = JSON.parse(row); } catch (_) { onSample({ error: true }); continue; }
        if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
          onSample({ error: true });
          continue;
        }
        if (typeof sample.detected === 'boolean' && !sample.error) retries = 0;
        onSample(sample);
      }
    });
    running.stderr.resume();
    running.on('error', () => {
      if (child !== running) return;
      child = null;
      running.kill();
      retry();
    });
    running.on('exit', () => {
      if (child !== running) return;
      child = null;
      retry();
    });
  }

  function start() {
    if (active) return;
    active = true;
    retries = 0;
    launch();
  }

  function stop() {
    active = false;
    clearTimeout(retryTimer);
    retryTimer = null;
    const running = child;
    child = null;
    running?.kill();
  }

  return { start, stop };
}

function buildQQClientMonitorScript() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
  $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
} | Select-Object -First 1
function Wait-MediaResult($Operation, [Type]$ResultType) {
  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  if (-not $task.Wait(5000)) { throw 'Media session timeout' }
  return $task.Result
}
$manager = Wait-MediaResult ($managerType::RequestAsync()) $managerType
while ($true) {
  try {
    $session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match '(?i)(^|\\)QQMusic(\.exe)?$' } | Select-Object -First 1
    if ($null -eq $session) {
      $sample = @{ detected = $false }
    } else {
      $media = Wait-MediaResult ($session.TryGetMediaPropertiesAsync()) $propertiesType
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $sample = @{
        detected = $true
        appId = $session.SourceAppUserModelId
        title = $media.Title
        artist = $media.Artist
        playbackStatus = $playback.PlaybackStatus.ToString()
        playbackRate = $playback.PlaybackRate
        positionMs = $timeline.Position.TotalMilliseconds
        durationMs = $timeline.EndTime.TotalMilliseconds
        timelineUpdatedAt = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
      }
    }
  } catch { $sample = @{ error = $true } }
  Write-Output ($sample | ConvertTo-Json -Compress)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}
`;
}

module.exports = { createQQClientMonitor, buildQQClientMonitorScript };
