'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../../src/server');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createOverlayToken } = require('../../src/server/access-policy');

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  return { response, payload: await response.json() };
}

test('WeSing routes require auth, persist cache path, and control monitor lifecycle', async (t) => {
  const root = createScratchDirectory('wesing-routes-');
  const dataDir = path.join(root, 'data');
  const cachePath = path.join(root, 'WeSingCache');
  fs.mkdirSync(path.join(cachePath, 'Log', 'WeSing'), { recursive: true });
  fs.writeFileSync(path.join(cachePath, 'Log', 'WeSing', 'test.log'), 'synthetic cache');
  let monitorStarts = 0;
  let monitorStops = 0;
  const runtime = createServerRuntime({
    dataDir,
    weSingPlatform: 'win32',
    weSingCacheDiscovery: async () => '',
    weSingMonitorFactory() {
      return {
        start() {
          monitorStarts += 1;
        },
        stop() {
          monitorStops += 1;
        },
      };
    },
  });
  t.after(async () => {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const app = await runtime.start({
    host: '127.0.0.1',
    startPort: 0,
  });
  const token = runtime.getApiToken();
  const unauthorized = await fetch(`${app.baseUrl}/api/music/wesing/status`);
  assert.equal(unauthorized.status, 401);
  const diagnosticUrl = `${app.baseUrl}/api/music/wesing/diagnose`;
  assert.equal((await fetch(diagnosticUrl, { method: 'POST' })).status, 401);
  assert.equal((await requestJson(diagnosticUrl, createOverlayToken(token, 'lyrics'), { method: 'POST' })).response.status, 403);
  const inactiveDiagnostic = await requestJson(diagnosticUrl, token, { method: 'POST' });
  assert.equal(inactiveDiagnostic.response.status, 400);
  assert.match(inactiveDiagnostic.payload.error, /请先打开/);
  const exportUrl = `${diagnosticUrl}/export`;
  assert.equal((await fetch(exportUrl, { method: 'POST' })).status, 401);
  assert.equal((await requestJson(exportUrl, createOverlayToken(token, 'lyrics'), { method: 'POST' })).response.status, 403);
  const missingReport = await requestJson(exportUrl, token, { method: 'POST', body: '{"startedAt":"not-a-report"}' });
  assert.equal(missingReport.response.status, 400);
  assert.match(missingReport.payload.error, /重新运行/);

  const configured = await requestJson(`${app.baseUrl}/api/music/wesing/configure`, token, {
    method: 'POST',
    body: JSON.stringify({ cachePath }),
  });
  assert.equal(configured.response.status, 200);
  assert.equal(configured.payload.ok, true);
  assert.equal(configured.payload.data.cachePath, cachePath);
  assert.equal(configured.payload.data.cacheReady, true);
  assert.equal(runtime.getSetting('weSingCachePath'), cachePath);

  const offset = await requestJson(`${app.baseUrl}/api/music/wesing/offset`, token, {
    method: 'POST',
    body: JSON.stringify({ offsetMs: -250 }),
  });
  assert.equal(offset.response.status, 200);
  assert.equal(offset.payload.data.lyricOffsetMs, -250);
  assert.equal(runtime.getSetting('weSingLyricOffsetMs'), '-250');

  const invalidOffset = await requestJson(`${app.baseUrl}/api/music/wesing/offset`, token, {
    method: 'POST',
    body: JSON.stringify({ offsetMs: 3001 }),
  });
  assert.equal(invalidOffset.response.status, 400);
  assert.match(invalidOffset.payload.error, /-3000.*3000/);
  assert.equal(runtime.getSetting('weSingLyricOffsetMs'), '-250');

  const activated = await requestJson(`${app.baseUrl}/api/music/wesing/active`, token, {
    method: 'POST',
    body: JSON.stringify({ active: true }),
  });
  assert.equal(activated.payload.data.active, true);
  assert.equal(monitorStarts, 1);

  const status = await requestJson(`${app.baseUrl}/api/music/wesing/status`, token);
  assert.equal(status.payload.data.active, true);
  assert.equal(status.payload.data.supported, true);
  assert.equal('rawLog' in status.payload.data, false);

  const nextCachePath = path.join(root, 'second', 'WeSingCache');
  fs.mkdirSync(path.join(nextCachePath, 'Log', 'WeSing'), { recursive: true });
  fs.writeFileSync(path.join(nextCachePath, 'Log', 'WeSing', 'test.log'), 'synthetic cache');
  const updated = await requestJson(`${app.baseUrl}/api/settings`, token, {
    method: 'POST',
    body: JSON.stringify({ weSingCachePath: nextCachePath, weSingLyricOffsetMs: 125 }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(runtime.getSetting('weSingCachePath'), nextCachePath);
  assert.equal(runtime.getSetting('weSingLyricOffsetMs'), '125');
  const updatedStatus = await requestJson(`${app.baseUrl}/api/music/wesing/status`, token);
  assert.equal(updatedStatus.payload.data.cachePath, nextCachePath);
  assert.equal(updatedStatus.payload.data.lyricOffsetMs, 125);
  assert.equal(updatedStatus.payload.data.cacheReady, true);
  assert.equal(updatedStatus.payload.data.active, true);

  const unchanged = await requestJson(`${app.baseUrl}/api/settings`, token, {
    method: 'POST',
    body: JSON.stringify({ weSingCachePath: nextCachePath, weSingLyricOffsetMs: 125 }),
  });
  assert.equal(unchanged.response.status, 200);
  assert.equal(monitorStarts, 1);
  assert.equal(monitorStops, 0);

  const invalidBatch = await requestJson(`${app.baseUrl}/api/settings`, token, {
    method: 'POST',
    body: JSON.stringify({ paused: true, weSingLyricOffsetMs: 3001 }),
  });
  assert.equal(invalidBatch.response.status, 400);
  assert.equal(runtime.getSetting('paused'), 'false');
  assert.equal(runtime.getSetting('weSingLyricOffsetMs'), '125');

  const unavailableCachePath = path.join(root, 'unavailable', 'WeSingCache');
  fs.mkdirSync(path.dirname(unavailableCachePath), { recursive: true });
  fs.writeFileSync(unavailableCachePath, 'synthetic file blocking the cache directory');
  const unavailableBatch = await requestJson(`${app.baseUrl}/api/settings`, token, {
    method: 'POST',
    body: JSON.stringify({ paused: true, weSingCachePath: unavailableCachePath, weSingLyricOffsetMs: 300 }),
  });
  assert.equal(unavailableBatch.response.status, 400);
  assert.equal(runtime.getSetting('paused'), 'false');
  assert.equal(runtime.getSetting('weSingCachePath'), nextCachePath);
  assert.equal(runtime.getSetting('weSingLyricOffsetMs'), '125');
  const afterFailure = await requestJson(`${app.baseUrl}/api/music/wesing/status`, token);
  assert.equal(afterFailure.payload.data.cachePath, nextCachePath);
  assert.equal(afterFailure.payload.data.lyricOffsetMs, 125);

  const restored = await requestJson(`${app.baseUrl}/api/music/wesing/configure`, token, {
    method: 'POST',
    body: JSON.stringify({ cachePath }),
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.data.cachePath, cachePath);
  assert.equal(restored.payload.data.lyricOffsetMs, 125);
  assert.equal(runtime.getSetting('weSingCachePath'), cachePath);
  const restoredOffset = await requestJson(`${app.baseUrl}/api/music/wesing/offset`, token, {
    method: 'POST',
    body: JSON.stringify({ offsetMs: -250 }),
  });
  assert.equal(restoredOffset.response.status, 200);
  assert.equal(restoredOffset.payload.data.lyricOffsetMs, -250);
  assert.equal(runtime.getSetting('weSingLyricOffsetMs'), '-250');
  assert.equal(monitorStarts, 1);
  assert.equal(monitorStops, 0);

  const invalid = await requestJson(`${app.baseUrl}/api/music/wesing/configure`, token, {
    method: 'POST',
    body: JSON.stringify({ cachePath: path.join(root, 'Other') }),
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.payload.error, /WeSingCache/);

  const deactivated = await requestJson(`${app.baseUrl}/api/music/wesing/active`, token, {
    method: 'POST',
    body: JSON.stringify({ active: false }),
  });
  assert.equal(deactivated.payload.data.active, true, 'clearing the preference must not disable detection');
  assert.equal(monitorStops, 0);
  assert.equal((await requestJson(`${app.baseUrl}/api/playback/lyric-source`, token)).payload.data.selection, 'auto');
});

test('WeSing diagnostic route returns the capture report without altering playback', async () => {
  const { routes } = require('../../src/server/routes/wesing-routes');
  const report = { version: 1, summary: { result: 'ready' }, samples: [] };
  let calls = 0;
  let status;
  let body;
  await routes['POST /api/music/wesing/diagnose']({ weSing: {
    async diagnose() { calls++; return report; },
  } }, {}, { writeHead(code) { status = code; }, end(value) { body = value; } });
  assert.equal(calls, 1);
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { ok: true, data: report });
});

test('WeSing diagnostic HTTP request is settled before server shutdown drains requests', async (t) => {
  const { routes } = require('../../src/server/routes/wesing-routes');
  const key = 'POST /api/music/wesing/diagnose';
  const original = routes[key];
  const entered = Promise.withResolvers();
  t.mock.method(routes, key, (...args) => {
    const pending = original(...args);
    entered.resolve();
    return pending;
  });
  const directory = createScratchDirectory('wesing-diagnostic-shutdown-', t);
  const runtime = createServerRuntime({ dataDir: directory, weSingPlatform: 'win32',
    weSingCacheDiscovery: async () => '', weSingMonitorFactory: () => ({ start() {}, stop() {} }),
  });
  t.after(() => runtime.stop({ exitProcess: false }));
  const app = await runtime.start({ host: '127.0.0.1', startPort: 0 });
  const token = runtime.getApiToken();
  await requestJson(`${app.baseUrl}/api/music/wesing/active`, token, { method: 'POST', body: '{"active":true}' });
  const request = requestJson(`${app.baseUrl}/api/music/wesing/diagnose`, token, { method: 'POST' });
  await entered.promise;
  const started = performance.now();
  await runtime.stop({ exitProcess: false });
  const result = await request;
  assert.ok(performance.now() - started < 10000, 'shutdown must not wait for the full 20-second recording');
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.reason, 'stopped');
});

test('WeSing export route accepts only a report identity and delegates file ownership', async () => {
  const { routes } = require('../../src/server/routes/wesing-routes');
  let received;
  let status;
  let body;
  const result = { path: 'logs/wesing-playback-diagnostic-2026-10-15_20-30-00-123.json' };
  await routes['POST /api/music/wesing/diagnose/export']({ weSing: {
    async exportDiagnostics(...args) { received = args; return result; },
  } }, { body: async () => ({ startedAt: '2026-10-15T12:30:00.123Z', path: '../outside.json', report: { token: 'untrusted' } }) },
  { writeHead(code) { status = code; }, end(value) { body = value; } });
  assert.deepEqual(received, ['2026-10-15T12:30:00.123Z']);
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { ok: true, data: result });
});
