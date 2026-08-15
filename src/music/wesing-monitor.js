'use strict';

const childProcess = require('node:child_process');
const { WESING_NATIVE_MONITOR_SOURCE } = require('./wesing-native-monitor-source');

function createPowerShellWeSingMonitor(onSample, options = {}) {
  const spawn = options.spawn || childProcess.spawn;
  let child = null;
  let stopping = false;
  let pending = '';
  let pendingError = '';

  function start() {
    if (child) return;
    stopping = false;
    const script = buildPowerShellMonitorScript(options);
    const encoded = Buffer.from(script, 'utf8').toString('base64');
    const command = `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | Invoke-Expression`;
    child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      const rows = pending.split(/\r?\n/);
      pending = rows.pop() || '';
      for (const row of rows) {
        if (!row.trim()) continue;
        try { onSample(JSON.parse(row)); } catch (_) {}
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      pendingError = `${pendingError}${chunk}`.slice(-2000);
    });
    child.on('error', (error) => {
      if (!stopping) onSample({ error: error.message || String(error) });
    });
    child.on('exit', (code) => {
      child = null;
      if (!stopping && code !== 0) {
        const detail = pendingError.trim();
        onSample({ error: detail || `监视进程已退出（${code}）` });
      }
      pendingError = '';
    });
  }

  function stop() {
    stopping = true;
    if (child) {
      try { child.kill(); } catch (_) {}
      child = null;
    }
  }

  return { start, stop };
}

function buildPowerShellMonitorScript(options = {}) {
  const includeDiagnostics = options.includeDiagnostics === true ? '$true' : '$false';
  const requestedIntervalMs = Math.round(Number(options.pollIntervalMs));
  const pollIntervalMs = Number.isFinite(requestedIntervalMs)
    ? Math.min(5000, Math.max(100, requestedIntervalMs))
    : 100;
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type -AssemblyName Accessibility | Out-Null
$nativeSource = @'
${WESING_NATIVE_MONITOR_SOURCE}
'@
Add-Type -TypeDefinition $nativeSource -ReferencedAssemblies Accessibility | Out-Null
$descendants = [System.Windows.Automation.TreeScope]::Descendants
$diagnosticsEnabled = ${includeDiagnostics}
while ($true) {
  $sample = @{ detected = $false; title = ''; currentSec = -1; totalSec = -1; loading = $false; audioPeak = -1; windowHandle = 0 }
  $processes = @()
  try {
    $processes = @(Get-Process -Name WeSing -ErrorAction SilentlyContinue)
    if ($processes.Count -gt 0) { $sample.detected = $true }
    $processIds = [int[]]@($processes | ForEach-Object { [int]$_.Id })
    if ($diagnosticsEnabled) { $sample.processIds = @($processIds) }
    $audioSnapshot = [WeSingNativeMonitor]::GetAudioSessionSnapshot($processIds)
    if ($audioSnapshot.State -ge 0) {
      $sample.audioActive = $audioSnapshot.State -eq 1
      $sample.audioPeak = [Math]::Round([double]$audioSnapshot.Peak, 6)
    }
    $windowSnapshot = [WeSingNativeMonitor]::FindPlaybackWindow($processIds)
    if ($null -ne $windowSnapshot) {
      $sample.title = $windowSnapshot.Title
      $sample.windowHandle = $windowSnapshot.Handle.ToInt64()
      $accessibleSnapshot = [WeSingNativeMonitor]::GetAccessiblePlaybackSnapshot($windowSnapshot.Handle)
      if ($accessibleSnapshot.CurrentSec -ge 0) {
        $sample.currentSec = $accessibleSnapshot.CurrentSec
        $sample.totalSec = $accessibleSnapshot.TotalSec
        $sample.progressSource = 'msaa'
      }
      if ($accessibleSnapshot.Loading) { $sample.loading = $true }
      try {
        $playWindow = [System.Windows.Automation.AutomationElement]::FromHandle($windowSnapshot.Handle)
        if ($null -ne $playWindow) {
          $textCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text
          )
          $texts = $playWindow.FindAll($descendants, $textCondition)
          foreach ($textElement in $texts) {
            $text = [string]$textElement.Current.Name
            if ($text -match '\u6b4c\u66f2\u52a0\u8f7d\u4e2d') { $sample.loading = $true }
            if ($sample.currentSec -lt 0 -and $text -match '^\s*(\d{1,3}):(\d{2})\s*\|\s*(\d{1,3}):(\d{2})\s*$') {
              $sample.currentSec = ([int]$matches[1] * 60) + [int]$matches[2]
              $sample.totalSec = ([int]$matches[3] * 60) + [int]$matches[4]
              $sample.progressSource = 'uia'
            }
          }
          if ($diagnosticsEnabled) {
            $controlRows = [System.Collections.Generic.List[object]]::new()
            $controls = $playWindow.FindAll(
              $descendants,
              [System.Windows.Automation.Condition]::TrueCondition
            )
            foreach ($control in $controls) {
              if ($controlRows.Count -ge 250) { break }
              try {
                $controlType = [string]$control.Current.ControlType.ProgrammaticName
                if ($controlType -notmatch '(Button|Text|Slider)') { continue }
                $controlName = [string]$control.Current.Name
                $automationId = [string]$control.Current.AutomationId
                if (-not $controlName -and -not $automationId) { continue }
                $controlRows.Add(@{
                  type = $controlType
                  name = $controlName
                  automationId = $automationId
                  enabled = [bool]$control.Current.IsEnabled
                })
              } catch {}
            }
            $sample.controls = @($controlRows)
          }
        }
      } catch {}
    }
  } catch {
    $sample.error = $_.Exception.Message
  } finally {
    foreach ($process in $processes) { $process.Dispose() }
  }
  Write-Output ($sample | ConvertTo-Json -Compress)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${pollIntervalMs}
}
`;
}

module.exports = {
  buildPowerShellMonitorScript,
  createPowerShellWeSingMonitor
};
