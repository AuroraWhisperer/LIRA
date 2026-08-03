'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const http = require('node:http');

const lifecycle = require('../src/server/lifecycle');

function cleanupOptions(dataDir, fetchImpl, canConnectToPort) {
  return {
    port: 3000,
    host: 'localhost',
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    cleanupTimeoutMs: 50,
    cleanupPollMs: 1,
    sleep: () => Promise.resolve(),
    fetch: fetchImpl,
    canConnectToPort
  };
}

function createPreviousServerFetch(dataDir, requests) {
  return async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          rootDir: path.resolve(__dirname, '..'),
          dataDir,
          pid: 12345
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}

test('cleanup sends the persisted session token to the previous instance', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-lifecycle-'));
  const requests = [];
  let released = false;

  try {
    fs.writeFileSync(path.join(dataDir, '.session-token'), 'previous-token\n', 'utf8');
    const fetchImpl = async (url, options) => {
      const response = await createPreviousServerFetch(dataDir, requests)(url, options);
      if (String(url).endsWith('/api/system/shutdown')) released = true;
      return response;
    };

    await lifecycle.cleanupOwnPortOccupant(cleanupOptions(
      dataDir,
      fetchImpl,
      async () => !released
    ));

    const shutdown = requests.find((request) => request.url.endsWith('/api/system/shutdown'));
    assert.ok(shutdown, 'the previous instance should receive a shutdown request');
    assert.equal(shutdown.options.headers.Authorization, 'Bearer previous-token');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup remains compatible with a previous instance that has no token file', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-lifecycle-'));
  const requests = [];
  let released = false;

  try {
    const fetchImpl = async (url, options) => {
      const response = await createPreviousServerFetch(dataDir, requests)(url, options);
      if (String(url).endsWith('/api/system/shutdown')) released = true;
      return response;
    };

    await lifecycle.cleanupOwnPortOccupant(cleanupOptions(
      dataDir,
      fetchImpl,
      async () => !released
    ));

    const shutdown = requests.find((request) => request.url.endsWith('/api/system/shutdown'));
    assert.ok(shutdown, 'the previous instance should receive a shutdown request');
    assert.equal(shutdown.options.headers.Authorization, undefined);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup checks the requested port when runtime info points to a fallback port', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-lifecycle-'));
  const requests = [];
  let released = false;

  try {
    lifecycle.writeRuntimeInfo(dataDir, { pid: 12345, port: 3001, host: 'localhost' });
    const fetchImpl = async (url, options) => {
      const response = await createPreviousServerFetch(dataDir, requests)(url, options);
      if (String(url).endsWith('/api/system/shutdown')) released = true;
      return response;
    };

    await lifecycle.cleanupOwnPortOccupant(cleanupOptions(
      dataDir,
      fetchImpl,
      async () => !released
    ));

    assert.match(requests[0].url, /:3000\/api\/health$/);
    assert.match(
      requests.find((request) => request.url.endsWith('/api/system/shutdown')).url,
      /:3000\/api\/system\/shutdown$/
    );
    assert.deepEqual(lifecycle.readRuntimeInfo(dataDir), {
      pid: 12345,
      port: 3001,
      host: 'localhost'
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup matches the same application across different data directories', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-lifecycle-'));
  const requests = [];
  let released = false;

  try {
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/api/health')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            serviceId: lifecycle.SERVICE_ID,
            dataDir: path.join(dataDir, 'previous-instance'),
            pid: 12345
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      released = true;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    await lifecycle.cleanupOwnPortOccupant(cleanupOptions(
      dataDir,
      fetchImpl,
      async () => !released
    ));

    assert.ok(requests.some((request) => request.url.endsWith('/api/system/shutdown')));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup leaves an unrelated service on port 3000 untouched', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-lifecycle-'));
  const requests = [];

  try {
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({
        ok: true,
        data: {
          serviceId: 'other-application',
          dataDir: path.join(dataDir, 'other-application'),
          pid: 12345
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    await lifecycle.cleanupOwnPortOccupant(cleanupOptions(
      dataDir,
      fetchImpl,
      async () => true
    ));

    assert.equal(requests.some((request) => request.url.endsWith('/api/system/shutdown')), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('session token cleanup never removes a token file owned by another instance', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-lifecycle-'));

  try {
    const tokenPath = lifecycle.writeSessionToken(dataDir, 'current-token');
    assert.equal(fs.readFileSync(tokenPath, 'utf8').trim(), 'current-token');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    }

    fs.writeFileSync(tokenPath, 'replacement-token\n', 'utf8');
    assert.equal(lifecycle.removeSessionToken(dataDir, 'current-token'), false);
    assert.equal(fs.readFileSync(tokenPath, 'utf8').trim(), 'replacement-token');
    assert.equal(lifecycle.removeSessionToken(dataDir, 'replacement-token'), true);
    assert.equal(fs.existsSync(tokenPath), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('listenWithFallback asks the OS for a free port when startPort is zero', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  try {
    const port = await lifecycle.listenWithFallback(server, {
      startPort: 0,
      host: '127.0.0.1'
    });
    assert.ok(Number.isInteger(port));
    assert.ok(port > 0);
    assert.equal(server.address().port, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('listenExactly rejects when the requested port is already in use', async () => {
  const first = http.createServer((_req, res) => res.end('first'));
  const second = http.createServer();
  try {
    await new Promise((resolve) => first.listen(0, '127.0.0.1', resolve));
    const address = first.address();
    const port = address && typeof address === 'object' ? address.port : 0;

    await assert.rejects(
      lifecycle.listenExactly(second, { port, host: '127.0.0.1' }),
      { code: 'EADDRINUSE' }
    );
  } finally {
    await new Promise((resolve) => first.close(resolve));
  }
});

test('runtime info records the previous pid and port and removes only its own record', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-runtime-'));
  try {
    lifecycle.writeRuntimeInfo(dataDir, { pid: 1234, port: 4567, host: '127.0.0.1' });
    assert.deepEqual(lifecycle.readRuntimeInfo(dataDir), {
      pid: 1234, port: 4567, host: '127.0.0.1'
    });
    assert.equal(lifecycle.removeRuntimeInfo(dataDir, { pid: 9999, port: 4567 }), false);
    assert.equal(lifecycle.removeRuntimeInfo(dataDir, { pid: 1234, port: 4567 }), true);
    assert.equal(lifecycle.readRuntimeInfo(dataDir), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
