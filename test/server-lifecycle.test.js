'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const http = require('node:http');

const lifecycle = require('../src/server/lifecycle');
const { createInflightTracker } = require('../src/server/inflight-tracker');

// Peer authorization and graceful/forced cleanup now use real HTTP in local-instance-security.test.js.
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
      host: '127.0.0.1',
    });
    assert.ok(Number.isInteger(port));
    assert.ok(port > 0);
    assert.equal(server.address().port, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('listenExactly reports the OS-assigned port when port is zero', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  try {
    const port = await lifecycle.listenExactly(server, {
      port: 0,
      host: '127.0.0.1',
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

    await assert.rejects(lifecycle.listenExactly(second, { port, host: '127.0.0.1' }), { code: 'EADDRINUSE' });
  } finally {
    await new Promise((resolve) => first.close(resolve));
  }
});

test('runtime info records the previous pid and port and removes only its own record', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-runtime-'));
  try {
    lifecycle.writeRuntimeInfo(dataDir, {
      pid: 1234,
      port: 4567,
      host: '127.0.0.1',
    });
    assert.deepEqual(lifecycle.readRuntimeInfo(dataDir), {
      pid: 1234,
      port: 4567,
      host: '127.0.0.1',
    });
    assert.equal(lifecycle.removeRuntimeInfo(dataDir, { pid: 9999, port: 4567 }), false);
    assert.equal(lifecycle.removeRuntimeInfo(dataDir, { pid: 1234, port: 4567 }), true);
    assert.equal(lifecycle.readRuntimeInfo(dataDir), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('inflight tracker rejects new work and drains already accepted handlers', async () => {
  const tracker = createInflightTracker();
  let release;
  const accepted = tracker.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );

  tracker.quiesce();
  const drain = tracker.drain();
  let drained = false;
  drain.then(() => {
    drained = true;
  });
  await assert.rejects(
    tracker.run(() => Promise.resolve()),
    (error) => error.code === 'SERVER_QUIESCING',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);

  release('done');
  assert.equal(await accepted, 'done');
  await drain;
  assert.equal(drained, true);
});
