'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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
