'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

// Bind process evidence to the actual loopback TCP endpoint, never a peer's PID.
function readPortOwner(port, remotePort) {
  if (process.platform !== 'win32' || !validPort(port)) return null;
  if (remotePort !== undefined && !validPort(remotePort)) return null;
  const connection = remotePort === undefined
    ? '-State Listen'
    : `-State Established -RemoteAddress 127.0.0.1 -RemotePort ${remotePort}`;
  try {
    const output = childProcess.execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$ownerId = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${port} ${connection} -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess; ` +
      'if ($ownerId) { ' +
      '$ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction Stop; ' +
      '$ownerSid = (Invoke-CimMethod -InputObject $ownerProcess -MethodName GetOwnerSid -ErrorAction Stop).Sid; ' +
      'if ($ownerSid -eq [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { ' +
      '$ownerProcess | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress } }',
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
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
    (executable.endsWith('\\electron.exe') &&
      (entryPath === root || entryPath === `${root}\\src\\electron\\main.js`)),
  );
}

function isSameProcess(previous, current, rootDir) {
  return Boolean(previous && current &&
    previous.ProcessId === current.ProcessId &&
    previous.CreationDate === current.CreationDate &&
    isOwnProcess(current, rootDir));
}

module.exports = { readPortOwner, isOwnProcess, isSameProcess };
