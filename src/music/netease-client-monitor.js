'use strict';

const { spawn: spawnProcess } = require('node:child_process');
const { parseNeteaseWindowTitle, readNeteaseClientTrack } = require('./netease-client-track');
const { NETEASE_NATIVE_PLAYER_SOURCE } = require('./netease-native-player-source');

const SCRIPT_INPUT_COMMAND = '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))';

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
    const key = JSON.stringify([result.windowTitle, result.title, result.artists, result.artist, result.durationMs, result.sourceTrackId]);
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
      if (result.clockSource === 'native' && result.sourceTrackId !== track.sourceTrackId) {
        track = null;
        nextTrackReadAt = 0;
        return { detected: true, playbackStatus: 'Changing', clockSource: 'native' };
      }
      result.title = track.title;
      result.artists = track.artists;
      result.sourceTrackId = track.sourceTrackId;
    }
    return result;
  }

  function launch() {
    if (!active || child) return;
    // The native readers exceed Windows' command-line limit. Keep the command
    // fixed and send trusted source through stdin, without a temporary script.
    const encoded = Buffer.from(SCRIPT_INPUT_COMMAND, 'utf16le').toString('base64');
    let running;
    try {
      running = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
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
    running.stdin.on('error', () => retire(running));
    armWatchdog(running);
    running.stdin.end(buildNeteaseClientMonitorScript(), 'utf8');
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
Add-Type -AssemblyName Accessibility
$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Accessibility;
public sealed class NeteasePlaybackWindow {
  public IntPtr Handle;
  public string Title;
  public int ProcessId;
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
      if (area > largestArea) { result = new NeteasePlaybackWindow { Handle = handle, Title = title, ProcessId = (int)processId }; largestArea = area; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
// Chromium's MSAA tree remains readable when the managed UIA bridge exposes
// only empty host panes. Cache only the two player controls, never invoke them.
public sealed class NeteaseAccessibleControl {
  public IAccessible Owner;
  public int Child;
  public string Name { get { return Owner.get_accName(Child) ?? ""; } }
  public int Top { get { int x, y, width, height; Owner.accLocation(out x, out y, out width, out height, Child); return y; } }
}
public sealed class NeteaseAccessiblePlayer {
  [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId,
    ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible result);
  [DllImport("oleacc.dll")] private static extern int AccessibleChildren(IAccessible parent, int start, int count,
    [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] object[] children, out int obtained);
  private readonly HashSet<IAccessible> retained = new HashSet<IAccessible>();
  private readonly List<NeteaseAccessibleControl> buttons = new List<NeteaseAccessibleControl>();
  public NeteaseAccessibleControl Progress;
  public NeteaseAccessibleControl State;
  public void Reset() {
    Progress = State = null;
    buttons.Clear();
    foreach (var owner in retained) Marshal.ReleaseComObject(owner);
    retained.Clear();
  }
  public void Scan(IntPtr window) {
    Reset();
    var iid = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
    IAccessible root;
    if (AccessibleObjectFromWindow(window, unchecked((uint)-4), ref iid, out root) != 0 || root == null) return;
    int visited = 0;
    Walk(root, 0, ref visited);
    try {
      if (Progress != null) {
        int distance = 100;
        foreach (var button in buttons) {
          int candidate = Math.Abs(button.Top - Progress.Top);
          if (candidate < distance) { State = button; distance = candidate; }
        }
      }
    } catch { Progress = State = null; }
    foreach (var owner in new List<IAccessible>(retained)) {
      if ((Progress == null || owner != Progress.Owner) && (State == null || owner != State.Owner)) {
        Marshal.ReleaseComObject(owner);
        retained.Remove(owner);
      }
    }
    buttons.Clear();
  }
  private void Observe(IAccessible owner, int child) {
    string name = owner.get_accName(child) ?? "";
    var control = new NeteaseAccessibleControl { Owner = owner, Child = child };
    if (Regex.IsMatch(name, @"^\s*\d{1,3}:\d{2}\s*[/|]\s*\d{1,3}:\d{2}\s*$")) {
      Progress = control;
      retained.Add(owner);
    } else if (Convert.ToInt32(owner.get_accRole(child)) == 43 &&
      Regex.IsMatch(name, @"^(暂停|播放|Pause|Play)(\s*\([^)]*\))?$", RegexOptions.IgnoreCase)) {
      buttons.Add(control);
      retained.Add(owner);
    }
  }
  private void Walk(IAccessible owner, int depth, ref int visited) {
    try {
      if (depth > 32 || visited++ >= 2000) return;
      Observe(owner, 0);
      int count = Math.Min(owner.accChildCount, Math.Max(0, 2000 - visited));
      if (count == 0) return;
      var children = new object[count];
      int obtained;
      AccessibleChildren(owner, 0, count, children, out obtained);
      for (int index = 0; index < obtained; index++) {
        var accessible = children[index] as IAccessible;
        if (accessible != null) Walk(accessible, depth + 1, ref visited);
        else if (children[index] is int && visited++ < 2000) {
          try { Observe(owner, (int)children[index]); }
          catch { continue; }
        }
      }
    } catch { return; }
    finally { if (!retained.Contains(owner)) Marshal.ReleaseComObject(owner); }
  }
}
${NETEASE_NATIVE_PLAYER_SOURCE}
'@
Add-Type -TypeDefinition $nativeSource -ReferencedAssemblies Accessibility
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
$accessiblePlayer = [NeteaseAccessiblePlayer]::new()
$nativePlayer = [NeteaseNativePlayer]::new()
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
          $accessiblePlayer.Reset()
          $nextScanAt = $sampledAt + 1500
        }
        $sample.windowTitle = $window.Title
        $native = $nativePlayer.Read($window.ProcessId)
        if ($null -ne $native) {
          $sample.clockSource = 'native'
          $sample.sourceTrackId = $native.SourceTrackId
          $sample.playbackStatus = $native.PlaybackStatus
          $sample.positionMs = $native.PositionMs
          $sample.durationMs = $native.DurationMs
          $sample.timelineUpdatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
          $progressElement = $null
          $stateElement = $null
          $accessiblePlayer.Reset()
        } else {
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
            if ($null -eq $progressElement) { $accessiblePlayer.Scan($window.Handle) }
            else { $accessiblePlayer.Reset() }
          }
          $stateName = if ($null -ne $stateElement) { [string]$stateElement.Current.Name }
            elseif ($null -ne $accessiblePlayer.State) { $accessiblePlayer.State.Name } else { '' }
          if ($stateName -match '^(暂停|Pause)') { $sample.playbackStatus = 'Playing' }
          elseif ($stateName -match '^(播放|Play)') { $sample.playbackStatus = 'Paused' }
          $progressName = if ($null -ne $progressElement) { [string]$progressElement.Current.Name }
            elseif ($null -ne $accessiblePlayer.Progress) { $accessiblePlayer.Progress.Name } else { '' }
          if ($progressName -match '^\s*(\d{1,3}):(\d{2})\s*[/|]\s*(\d{1,3}):(\d{2})\s*$') {
            if ([int]$matches[2] -lt 60 -and [int]$matches[4] -lt 60) {
              $sample.positionMs = (([int]$matches[1] * 60) + [int]$matches[2]) * 1000
              $sample.durationMs = (([int]$matches[3] * 60) + [int]$matches[4]) * 1000
              $sample.timelineUpdatedAt = $sampledAt
            }
          }
        }
        if ([NeteasePlaybackWindows]::ReadTitle($window.Handle) -ne $window.Title) {
          $sample = @{ detected = $true; playbackStatus = 'Changing'; clockSource = 'uia' }
        }
      } else { $lastWindow = ''; $progressElement = $null; $stateElement = $null; $accessiblePlayer.Reset(); $nativePlayer.Dispose() }
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
