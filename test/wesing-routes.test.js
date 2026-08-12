'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../src/server');

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  return { response, payload: await response.json() };
}

test('WeSing routes require auth, persist cache path, and control monitor lifecycle', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-routes-'));
  const dataDir = path.join(root, 'data');
  const cachePath = path.join(root, 'WeSingCache');
  fs.mkdirSync(path.join(cachePath, 'WeSingDL', 'Res'), { recursive: true });
  let monitorStarts = 0;
  let monitorStops = 0;
  const runtime = createServerRuntime({
    dataDir,
    weSingPlatform: 'win32',
    weSingMonitorFactory() {
      return {
        start() { monitorStarts += 1; },
        stop() { monitorStops += 1; }
      };
    }
  });
  t.after(async () => {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const app = await runtime.start({ host: '127.0.0.1', startPort: await findAvailablePort() });
  const token = runtime.getApiToken();
  const unauthorized = await fetch(`${app.baseUrl}/api/music/wesing/status`);
  assert.equal(unauthorized.status, 401);

  const configured = await requestJson(`${app.baseUrl}/api/music/wesing/configure`, token, {
    method: 'POST',
    body: JSON.stringify({ cachePath })
  });
  assert.equal(configured.response.status, 200);
  assert.equal(configured.payload.ok, true);
  assert.equal(configured.payload.data.cachePath, cachePath);
  assert.equal(configured.payload.data.cacheReady, true);
  assert.equal(runtime.getSetting('weSingCachePath'), cachePath);

  const activated = await requestJson(`${app.baseUrl}/api/music/wesing/active`, token, {
    method: 'POST',
    body: JSON.stringify({ active: true })
  });
  assert.equal(activated.payload.data.active, true);
  assert.equal(monitorStarts, 1);

  const status = await requestJson(`${app.baseUrl}/api/music/wesing/status`, token);
  assert.equal(status.payload.data.active, true);
  assert.equal(status.payload.data.supported, true);
  assert.equal('rawLog' in status.payload.data, false);

  const invalid = await requestJson(`${app.baseUrl}/api/music/wesing/configure`, token, {
    method: 'POST',
    body: JSON.stringify({ cachePath: path.join(root, 'Other') })
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.payload.error, /WeSingCache/);

  const deactivated = await requestJson(`${app.baseUrl}/api/music/wesing/active`, token, {
    method: 'POST',
    body: JSON.stringify({ active: false })
  });
  assert.equal(deactivated.payload.data.active, false);
  assert.equal(monitorStops, 1);
});
