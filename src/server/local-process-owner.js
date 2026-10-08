'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

// Bind process evidence to the actual loopback TCP endpoint, never a peer's PID.
function readPortOwner(port, remotePort) {
  if (process.platform !== 'win32' || !validPort(port)) return null;
  if (remotePort !== undefined && !validPort(remotePort)) return null;
  // Read the native numeric table directly; the TCP WMI provider can take seconds.
  const remote = remotePort === undefined ? '0\\.0\\.0\\.0:0' : `127\\.0\\.0\\.1:${remotePort}`;
  const state = remotePort === undefined ? 'LISTENING' : 'ESTABLISHED';
  const endpoint = `^\\s*TCP\\s+127\\.0\\.0\\.1:${port}\\s+${remote}\\s+${state}\\s+([0-9]+)\\s*$`;
  try {
    const output = childProcess.execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference = 'Stop'; " +
          '$ownerIds = @(& "$env:SystemRoot\\System32\\netstat.exe" -ano -p TCP | ' +
          `ForEach-Object { if ($_ -match '${endpoint}') { [int]$Matches[1] } }); ` +
          'if ($LASTEXITCODE -ne 0) { exit 1 }; ' +
          'if ($ownerIds.Count -eq 1 -and $ownerIds[0] -gt 0) { $ownerId = $ownerIds[0]; ' +
          '$ownerProcess = [wmi]("Win32_Process.Handle=\'$ownerId\'"); ' +
          '$ownerSid = $ownerProcess.GetOwnerSid().Sid; ' +
          'if ($ownerSid -eq [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { ' +
          '$ownerProcess | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress } }',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const info = output.trim() ? JSON.parse(output) : null;
    return Number.isInteger(info?.ProcessId) && info.ProcessId > 0 && info.CreationDate ? info : null;
  } catch (_) {
    return null;
  }
}

function validPort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function normalizePath(value) {
  return value ? path.resolve(String(value)).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() : '';
}

function isOwnProcess(info, rootDir) {
  if (!info || typeof info !== 'object') return false;
  const executable = normalizePath(info.ExecutablePath);
  const args = String(info.CommandLine || '').match(/"[^"]*"|[^\s"]+/g) || [];
  const entry = (args[1] || '').replace(/^"|"$/g, '');
  const entryPath = path.isAbsolute(entry) ? normalizePath(entry) : '';
  const root = normalizePath(rootDir);
  if (!root) return false;
  const packagedExecutable = root.replace(/\\resources\\app(?:\.asar)?$/, '\\lira.exe');
  return Boolean(
    (executable.endsWith('\\lira.exe') && executable === packagedExecutable) ||
    (executable.endsWith('\\node.exe') && entryPath === `${root}\\src\\server.js`) ||
    (executable.endsWith('\\electron.exe') && (entryPath === root || entryPath === `${root}\\src\\electron\\main.js`)),
  );
}

function isSameProcess(previous, current, rootDir) {
  return Boolean(
    previous &&
    current &&
    previous.ProcessId === current.ProcessId &&
    previous.CreationDate === current.CreationDate &&
    isOwnProcess(current, rootDir),
  );
}

module.exports = { readPortOwner, isOwnProcess, isSameProcess };
