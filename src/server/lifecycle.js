// Local HTTP server startup and previous-instance cleanup helpers.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const SESSION_TOKEN_FILE_NAME = '.session-token';
const RUNTIME_FILE_NAME = '.server-runtime.json';

async function listenWithFallback(server, options) {
  const startPort = Number(options.startPort);
  const host = options.host;
  if (startPort === 0) {
    const ok = await tryListen(server, 0, host);
    if (ok) {
      const address = server.address();
      return address && typeof address === 'object' ? address.port : 0;
    }
    throw new Error('Could not bind to an automatically assigned local port.');
  }
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
  const runtime = readRuntimeInfo(options.dataDir);
  const requestedPort = Number(options.port);
  const port = runtime && Number(runtime.port) > 0
    ? Number(runtime.port)
    : (requestedPort === 0 ? 3000 : requestedPort);
  const host = runtime && runtime.host ? runtime.host : options.host;
  if (!Number.isInteger(port) || port <= 0) return;
  if (runtime && Number(runtime.pid) === process.pid) return;

  const fetchImpl = options.fetch || globalThis.fetch;
  const health = await readLocalHealth(port, host, fetchImpl);
  const healthIsOwn = health && health.ok && isOwnServiceHealth(health.data, options);
  const runtimePid = runtime && Number(runtime.pid);
  const processInfo = Number.isInteger(runtimePid) && runtimePid > 0
    ? getProcessInfo(runtimePid) : null;
  const processIsOwn = isOwnProcessInfo(processInfo, options);
  if (!healthIsOwn && !processIsOwn) {
    if (runtime) removeRuntimeInfo(options.dataDir, runtime);
    return;
  }

  console.log(`Found previous song helper service on ${host}:${port}; asking it to shut down...`);
  await requestLocalShutdown(port, host, readSessionToken(options.dataDir), fetchImpl);
  if (await waitForPortRelease(port, host, options)) {
    if (runtime) removeRuntimeInfo(options.dataDir, runtime);
    return;
  }

  const pid = runtimePid || Number(health.data && health.data.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

  const currentProcessInfo = processInfo || getProcessInfo(pid);
  if (!isOwnProcessInfo(currentProcessInfo, options)) return;

  console.log(`Previous service did not exit cleanly; stopping pid ${pid}.`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    console.warn(`Could not stop previous service pid ${pid}: ${error.message}`);
    return;
  }
  await waitForPortRelease(port, host, options);
  if (runtime) removeRuntimeInfo(options.dataDir, runtime);
}

async function readLocalHealth(port, host, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`http://${toLocalHost(host)}:${port}/api/health`, {
      signal: AbortSignal.timeout(500)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function requestLocalShutdown(port, host, token = '', fetchImpl = globalThis.fetch) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetchImpl(`http://${toLocalHost(host)}:${port}/api/system/shutdown`, {
      method: 'POST',
      headers,
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
  const checkPort = options.canConnectToPort || canConnectToPort;
  while (Date.now() < deadline) {
    if (!(await checkPort(port, host))) return true;
    await options.sleep(pollMs);
  }
  return false;
}

function getSessionTokenPath(dataDir) {
  return path.join(path.resolve(String(dataDir || '')), SESSION_TOKEN_FILE_NAME);
}

function readSessionToken(dataDir) {
  try {
    return fs.readFileSync(getSessionTokenPath(dataDir), 'utf8').trim();
  } catch (_) {
    return '';
  }
}

function writeSessionToken(dataDir, token) {
  const value = String(token || '').trim();
  if (!value) throw new Error('Session token is required.');
  const tokenPath = getSessionTokenPath(dataDir);
  fs.writeFileSync(tokenPath, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(tokenPath, 0o600);
  } catch (_) {
    // Windows and some filesystems do not support POSIX permission bits.
  }
  return tokenPath;
}

function removeSessionToken(dataDir, token) {
  const value = String(token || '').trim();
  if (!value || readSessionToken(dataDir) !== value) return false;
  try {
    fs.unlinkSync(getSessionTokenPath(dataDir));
    return true;
  } catch (_) {
    return false;
  }
}

function getRuntimeInfoPath(dataDir) {
  return path.join(path.resolve(String(dataDir || '')), RUNTIME_FILE_NAME);
}

function readRuntimeInfo(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(getRuntimeInfoPath(dataDir), 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

function writeRuntimeInfo(dataDir, info) {
  const value = {
    pid: Number(info && info.pid),
    port: Number(info && info.port),
    host: String(info && info.host || '')
  };
  if (!Number.isInteger(value.pid) || value.pid <= 0 || !Number.isInteger(value.port) || value.port <= 0) {
    throw new Error('Runtime info requires a valid pid and port.');
  }
  fs.writeFileSync(getRuntimeInfoPath(dataDir), `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  return getRuntimeInfoPath(dataDir);
}

function removeRuntimeInfo(dataDir, expected) {
  const current = readRuntimeInfo(dataDir);
  if (expected && current && (Number(expected.pid) !== Number(current.pid) || Number(expected.port) !== Number(current.port))) return false;
  try {
    fs.unlinkSync(getRuntimeInfoPath(dataDir));
    return true;
  } catch (_) {
    return false;
  }
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
  SESSION_TOKEN_FILE_NAME,
  cleanupOwnPortOccupant,
  listenWithFallback,
  readSessionToken,
  writeSessionToken,
  removeSessionToken,
  RUNTIME_FILE_NAME,
  readRuntimeInfo,
  writeRuntimeInfo,
  removeRuntimeInfo
};
