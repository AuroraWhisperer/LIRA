// Local HTTP server startup and previous-instance cleanup helpers.
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { requestVerifiedShutdown } = require('./local-instance');
const { readPortOwner, isSameProcess } = require('./local-process-owner');

const SESSION_TOKEN_FILE_NAME = '.session-token';
const RUNTIME_FILE_NAME = '.server-runtime.json';
const SERVICE_ID = 'lira';

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

function listenExactly(server, options) {
  const port = Number(options.port);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      resolve(address && typeof address === 'object' ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, options.host);
  });
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
  const reportPhase = typeof options.onPhase === 'function' ? options.onPhase : () => {};
  const phaseStart = Date.now();
  const markPhase = (phase, extra = {}) => reportPhase(phase, Date.now() - phaseStart, extra);
  const requestedPort = Number(options.port);
  const port = requestedPort;
  const host = options.host;
  if (!Number.isInteger(port) || port <= 0) {
    markPhase('port-cleanup', { result: 'skipped-invalid-port' });
    return;
  }
  const runtime = readRuntimeInfo(options.dataDir);
  const runtimeForPort = runtime && Number(runtime.port) === port ? runtime : null;
  if (runtimeForPort && Number(runtimeForPort.pid) === process.pid) {
    markPhase('port-cleanup', { result: 'skipped-current-process' });
    return;
  }

  const gracefulStart = Date.now();
  const attempt = await requestVerifiedShutdown({
    port,
    rootDir: options.rootDir,
    token: readSessionToken(options.dataDir),
  });
  reportPhase('port-health-check', Date.now() - gracefulStart, {
    ok: attempt.verified,
  });
  if (!attempt.verified) {
    markPhase('port-cleanup', { result: 'untouched-unverified' });
    return;
  }
  const gracefulReleased = await waitForPortRelease(port, host, options);
  reportPhase('port-graceful-wait', Date.now() - gracefulStart, {
    released: gracefulReleased,
  });
  if (gracefulReleased) {
    if (runtimeForPort) removeRuntimeInfo(options.dataDir, runtimeForPort);
    markPhase('port-cleanup', { result: 'graceful' });
    return;
  }

  const owner = attempt.owner;
  if (!owner || owner.ProcessId === process.pid || !isSameProcess(owner, readPortOwner(port), options.rootDir)) {
    markPhase('port-cleanup', { result: 'graceful-timeout-unverified' });
    return;
  }
  const pid = owner.ProcessId;

  console.log(`Previous service did not exit cleanly; stopping pid ${pid}.`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    console.warn(`Could not stop previous service pid ${pid}: ${error.message}`);
    markPhase('port-cleanup', { result: 'terminate-failed' });
    return;
  }
  const terminateStart = Date.now();
  const terminateReleased = await waitForPortRelease(port, host, options);
  reportPhase('port-terminate-wait', Date.now() - terminateStart, {
    released: terminateReleased,
  });
  if (runtimeForPort) removeRuntimeInfo(options.dataDir, runtimeForPort);
  markPhase('port-cleanup', {
    result: terminateReleased ? 'terminated' : 'terminate-timeout',
  });
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
    host: String((info && info.host) || ''),
  };
  if (!Number.isInteger(value.pid) || value.pid <= 0 || !Number.isInteger(value.port) || value.port <= 0) {
    throw new Error('Runtime info requires a valid pid and port.');
  }
  fs.writeFileSync(getRuntimeInfoPath(dataDir), `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return getRuntimeInfoPath(dataDir);
}

function removeRuntimeInfo(dataDir, expected) {
  const current = readRuntimeInfo(dataDir);
  if (
    expected &&
    current &&
    (Number(expected.pid) !== Number(current.pid) || Number(expected.port) !== Number(current.port))
  )
    return false;
  try {
    fs.unlinkSync(getRuntimeInfoPath(dataDir));
    return true;
  } catch (_) {
    return false;
  }
}

function canConnectToPort(port, host) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: toLocalHost(host),
        port,
        path: '/api/health',
        method: 'GET',
        timeout: 250,
      },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function toLocalHost(host) {
  return host === 'localhost' ? '127.0.0.1' : host;
}

module.exports = {
  SESSION_TOKEN_FILE_NAME,
  SERVICE_ID,
  cleanupOwnPortOccupant,
  listenExactly,
  listenWithFallback,
  readSessionToken,
  writeSessionToken,
  removeSessionToken,
  RUNTIME_FILE_NAME,
  readRuntimeInfo,
  writeRuntimeInfo,
  removeRuntimeInfo,
};
