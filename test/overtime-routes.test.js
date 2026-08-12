'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../src/server');

test('overtime API requires auth, validates commands, extends snapshots, and broadcasts updates', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-overtime-routes-'));
  const runtime = createServerRuntime({ dataDir });

  try {
    const app = await runtime.start({ host: '127.0.0.1', startPort: await findAvailablePort() });
    const token = runtime.getApiToken();

    const unauthorized = await fetch(`${app.baseUrl}/api/overtime`);
    assert.equal(unauthorized.status, 401);

    const initial = await requestJson(app.baseUrl, token, '/api/overtime');
    assert.equal(initial.enabled, false);
    assert.equal(initial.pendingCount, 0);
    assert.deepEqual(initial.settlements, []);

    const snapshotMessage = await readNextWebSocketMessage(app.baseUrl, token);
    assert.equal(snapshotMessage.type, 'snapshot');
    assert.equal(snapshotMessage.state.overtime.status, 'disabled');
    assert.equal(snapshotMessage.state.giftDetection.consumers.overtime, false);

    const invalid = await postJson(app.baseUrl, token, '/api/overtime/action', { action: 'launch' });
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.payload.error, /action/);

    const updatePromise = readNextWebSocketMessage(app.baseUrl, token, async () => {
      const enabled = await postJson(app.baseUrl, token, '/api/overtime/action', { action: 'enable' });
      assert.equal(enabled.response.status, 200);
      assert.equal(enabled.payload.data.enabled, true);
    }, message => message.type === 'overtime:update');
    const update = await updatePromise;
    assert.equal(update.reason, 'manual');
    assert.equal(update.state.enabled, true);
    assert.equal(update.state.revision > 0, true);

    const configured = await postJson(app.baseUrl, token, '/api/overtime/time', {
      initialSeconds: 600,
      remainingSeconds: 300
    });
    assert.equal(configured.response.status, 200);
    assert.equal(configured.payload.data.effectiveRemainingMs, 300_000);

    const malicious = await postJson(app.baseUrl, token, '/api/overtime/config', {
      path: '../secret.png',
      fit: 'cover'
    });
    assert.equal(malicious.response.status, 400);
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

async function requestJson(baseUrl, token, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error || pathname);
  return payload.data;
}

async function postJson(baseUrl, token, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function readNextWebSocketMessage(baseUrl, token, afterOpen, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`
    );
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for overtime WebSocket message.'));
    }, 2000);
    socket.addEventListener('message', async (event) => {
      const message = JSON.parse(String(event.data));
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.close();
      resolve(message);
    });
    socket.addEventListener('open', async () => {
      if (!afterOpen) return;
      try {
        await afterOpen();
      } catch (error) {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      }
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Overtime WebSocket connection failed.'));
    }, { once: true });
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
