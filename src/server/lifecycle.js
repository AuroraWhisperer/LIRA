// Local HTTP server startup and previous-instance cleanup helpers.
'use strict';

const childProcess = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

async function listenWithFallback(server, options) {
  const startPort = Number(options.startPort);
  const host = options.host;
  for (let port = startPort; port < startPort + 20; port += 1) {
    const ok = await tryListen(server, port, host);
    if (ok) return port;
  }
  throw new Error(`No available local port from ${startPort} to ${startPort + 19}.`);
}

function tryListen(server, port, host) {
  return new Promise((resolve) => {
    const onError = () => {
      server.off('listening', onListening);
      resolve(false);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function cleanupOwnPortOccupant(options) {
  const port = Number(options.port);
  const host = options.host;
  if (port !== 3000) return;

  const health = await readLocalHealth(port, host);
  if (!health || !health.ok || !isOwnServiceHealth(health.data, options)) return;

  console.log(`Found previous song helper service on ${host}:${port}; asking it to shut down...`);
  await requestLocalShutdown(port, host);
  if (await waitForPortRelease(port, host, options)) return;

  const pid = Number(health.data && health.data.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

  const processInfo = getProcessInfo(pid);
  if (!isOwnProcessInfo(processInfo, options)) return;

  console.log(`Previous service did not exit cleanly; stopping pid ${pid}.`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    console.warn(`Could not stop previous service pid ${pid}: ${error.message}`);
    return;
  }
  await waitForPortRelease(port, host, options);
}

async function readLocalHealth(port, host) {
  try {
    const response = await fetch(`http://${toLocalHost(host)}:${port}/api/health`, {
      signal: AbortSignal.timeout(500)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function requestLocalShutdown(port, host) {
  try {
    await fetch(`http://${toLocalHost(host)}:${port}/api/system/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(500)
    });
  } catch (_) {
    // The previous process can close the connection while shutting down.
  }
}

async function waitForPortRelease(port, host, options) {
  const timeoutMs = Number(options.cleanupTimeoutMs);
  const pollMs = Number(options.cleanupPollMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await canConnectToPort(port, host))) return true;
    await options.sleep(pollMs);
  }
  return false;
}

function canConnectToPort(port, host) {
  return new Promise((resolve) => {
    const req = http.request({
      host: toLocalHost(host),
      port,
      path: '/api/health',
      method: 'GET',
      timeout: 250
    }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function isOwnServiceHealth(data, options) {
  if (!data || typeof data !== 'object') return false;
  const healthRoot = normalizePathForCompare(data.rootDir);
  const healthData = normalizePathForCompare(data.dataDir);
  const ownRoot = normalizePathForCompare(options.rootDir);
  const ownData = normalizePathForCompare(options.dataDir);

  return (healthRoot && healthRoot === ownRoot)
    || (healthData && healthData === ownData);
}

function getProcessInfo(pid) {
  if (process.platform !== 'win32') return null;
  try {
    const output = childProcess.execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -First 1 ExecutablePath,CommandLine | ConvertTo-Json -Compress`
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 1200
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch (_) {
    return null;
  }
}

function isOwnProcessInfo(info, options) {
  if (!info || typeof info !== 'object') return false;
  const executablePath = normalizePathForCompare(info.ExecutablePath || '');
  const commandLine = String(info.CommandLine || '').toLowerCase();
  const ownRoot = normalizePathForCompare(options.rootDir);

  return (executablePath && executablePath.endsWith('\\点歌助手.exe'))
    || (ownRoot && commandLine.includes(ownRoot.toLowerCase()))
    || commandLine.includes('src\\server.js')
    || commandLine.includes('src/server.js');
}

function toLocalHost(host) {
  return host === 'localhost' ? '127.0.0.1' : host;
}

function normalizePathForCompare(value) {
  if (!value) return '';
  return path.resolve(String(value)).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

module.exports = {
  cleanupOwnPortOccupant,
  listenWithFallback
};
