'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../../src/server');

test('external source routes protect access, independently detect and stop captures on shutdown', async (t) => {
  const parent = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'qq-client-routes-'));
  let sample;
  let starts = 0;
  let stops = 0;
  const runtime = createServerRuntime({
    dataDir: path.join(root, 'data'), nativeMusicCapture: true, qqClientPlatform: 'win32',
    neteaseClientPlatform: 'win32',
    neteaseClientMonitorFactory: () => ({ start() {}, stop() {} }),
    qqClientMonitorFactory(callback) {
      sample = callback;
      return { start() { starts++; }, stop() { stops++; } };
    },
    qqClientLyricResolver: async () => ({ source: 'qq', lines: [{ startMs: 0, text: 'Synthetic QQ lyric' }] }),
    weSingPlatform: 'win32',
    weSingMonitorFactory: () => ({ start() {}, stop() {} }),
  });
  t.after(async () => {
    await runtime.stop({ exitProcess: false });
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(parent));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const { baseUrl } = await runtime.start({ host: '127.0.0.1', startPort: 0 });
  async function request(route, body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${runtime.getApiToken()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, ...(await response.json()) };
  }
  const sourceRoute = '/api/playback/lyric-source';
  for (const [method, route] of [['GET', sourceRoute], ['POST', sourceRoute], ['POST', `${sourceRoute}/refresh`]]) {
    assert.equal((await fetch(`${baseUrl}${route}`, { method })).status, 401);
  }
  assert.equal((await request(sourceRoute)).data.source, 'internal');
  assert.equal((await request(sourceRoute)).data.selection, 'auto');
  assert.equal((await request(sourceRoute, { source: 'invalid-client' })).status, 400);
  assert.equal((await request(sourceRoute, { source: 'netease-client' })).status, 200);
  assert.equal(starts, 1, 'desktop startup detects players without selecting a source');
  await request(sourceRoute, { source: 'qq-client' });
  await request(sourceRoute, { source: 'qq-client' });
  assert.equal(starts, 1, 'reselecting QQ must not duplicate the monitor');
  const oldCallback = sample;
  const nativeState = { detected: true, appId: 'QQMusic.exe', title: 'Synthetic QQ', artist: 'Artist',
    playbackStatus: 'Playing', positionMs: 1000, durationMs: 180000, timelineUpdatedAt: Date.now() };
  sample(nativeState); sample(nativeState);
  await new Promise(setImmediate);
  let snapshot = (await request('/api/state')).data;
  assert.equal(snapshot.lyricSource.source, 'qq-client');
  assert.equal(snapshot.lyricSource.qqClient.status, 'ready');
  assert.equal(snapshot.lyricTimeline.lines[0].text, 'Synthetic QQ lyric');
  await request('/api/playback/lyric-state', { trackTitle: 'Stale internal', generation: 900, sequence: 1, status: 'ready' });
  await request('/api/playback/lyric-timeline', { trackTitle: 'Stale internal', status: 'ready', lines: [] });
  await request('/api/music/wesing/active', { active: false });
  snapshot = (await request('/api/state')).data;
  assert.equal(snapshot.lyricSource.source, 'qq-client', 'legacy WeSing deactivation must not release QQ');
  assert.equal(snapshot.lyricState.trackTitle, 'Synthetic QQ');
  assert.equal(snapshot.lyricTimeline.trackTitle, 'Synthetic QQ');
  await request(`${sourceRoute}/refresh`, { source: 'qq-client' });
  assert.equal(starts, 2);
  assert.equal(stops, 1);
  oldCallback(nativeState);
  assert.equal((await request(sourceRoute)).data.qqClient.detected, false, 'old monitor callbacks must stay retired');
  await request('/api/music/wesing/active', { active: true });
  assert.equal((await request(sourceRoute)).data.source, 'wesing');
  assert.equal(stops, 1, 'source preference must not stop QQ detection');
  await request(sourceRoute, { source: 'internal' });
  assert.equal((await request('/api/music/wesing/status')).data.active, true);
  await request('/api/playback/lyric-state', { trackTitle: 'Internal', status: 'ready', playing: false });
  assert.equal((await request('/api/state')).data.lyricState.trackTitle, 'Internal');
  await request(sourceRoute, { source: 'qq-client' });
  await runtime.stop({ exitProcess: false });
  assert.equal(stops, starts, 'all QQ monitors must stop on shutdown');
});
