'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildPowerShellMonitorScript,
  createWeSingCapture,
  findLatestSongEntry,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
} = require('../src/music/wesing-capture');
const { createFixture } = require('./helpers/wesing-capture-fixture');

test('WeSing capture facade preserves focused module exports', () => {
  const facade = require('../src/music/wesing-capture');
  const engine = require('../src/music/wesing-capture-engine');
  const cache = require('../src/music/wesing-cache');
  const monitor = require('../src/music/wesing-monitor');

  assert.equal(facade.createWeSingCapture, engine.createWeSingCapture);
  assert.equal(facade.loadWeSingLyrics, cache.loadWeSingLyrics);
  assert.equal(
    facade.buildPowerShellMonitorScript,
    monitor.buildPowerShellMonitorScript,
  );
});

test('WeSing cache parser reads matching UTF-16LE log and decrypts local word-timed QRC', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const entry = await findLatestSongEntry(fixture.cachePath, '测试歌曲');
  assert.deepEqual(entry, {
    mid: fixture.mid,
    songName: '测试歌曲',
    artist: '测试歌手',
  });

  const result = await loadWeSingLyrics({
    cachePath: fixture.cachePath,
    title: '测试歌曲',
  });
  assert.equal(result.songMid, fixture.mid);
  assert.equal(result.title, '测试歌曲');
  assert.deepEqual(result.artists, ['测试歌手']);
  assert.equal(result.durationMs, 8000);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].text, '你好');
  assert.deepEqual(result.lines[0].words, [
    { text: '你', startMs: 1000, endMs: 1800 },
    { text: '好', startMs: 1800, endMs: 2800 },
  ]);
});

test('WeSing log parser ignores title mismatches and unsafe song IDs', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const logPath = path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-2.log');
  fs.writeFileSync(
    logPath,
    Buffer.from(
      'event "StartKSong" payload {"mid":"..\\..\\secret","songname":"测试歌曲"}',
      'utf16le',
    ),
  );
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(logPath, future, future);

  assert.equal(await findLatestSongEntry(fixture.cachePath, '另一首歌'), null);
  assert.equal(await findLatestSongEntry(fixture.cachePath, '测试歌曲'), null);
  assert.throws(
    () => normalizeWeSingCachePath('relative\\WeSingCache'),
    /绝对路径/,
  );
  assert.throws(
    () => normalizeWeSingCachePath('C:\\Temp\\OtherFolder'),
    /WeSingCache/,
  );
});

test('WeSing cache configuration creates a missing user cache directory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-missing-cache-'));
  const cachePath = path.join(root, 'Tencent', 'WeSing', 'WeSingCache');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const capture = createWeSingCapture({ platform: 'win32' });
  const status = await capture.setCachePath(cachePath);

  assert.equal(status.cachePath, cachePath);
  assert.equal(fs.statSync(cachePath).isDirectory(), true);
});

test('WeSing activation creates a missing initial cache directory before detection starts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-initial-cache-'));
  const cachePath = path.join(root, 'Tencent', 'WeSing', 'WeSingCache');
  let cacheExistedAtMonitorStart = false;
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const capture = createWeSingCapture({
    cachePath,
    platform: 'win32',
    monitorFactory() {
      return {
        start() {
          cacheExistedAtMonitorStart = fs.existsSync(cachePath);
        },
        stop() {},
      };
    },
  });
  t.after(() => capture.stop());

  const status = await capture.setActive(true);

  assert.equal(status.active, true);
  assert.equal(cacheExistedAtMonitorStart, true);
});

test('unchanged WeSing configuration preserves listeners and does not reset capture state', async (t) => {
  const fixture = createFixture();
  let starts = 0;
  let stops = 0;
  let watchers = 0;
  let closed = 0;
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    monitorFactory: () => ({ start() { starts += 1; }, stop() { stops += 1; } }),
    watchFactory: () => { watchers += 1; return { close() { closed += 1; } }; },
  });
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  await capture.setActive(true);
  const before = capture.getStatus();
  await capture.setCachePath(fixture.cachePath);
  await capture.setLyricOffsetMs(0);
  assert.deepEqual(capture.getStatus(), before);
  assert.deepEqual({ starts, stops, watchers, closed }, { starts: 1, stops: 0, watchers: 1, closed: 0 });
});

test('configuring the initial cache directory still refreshes its readiness', async (t) => {
  const fixture = createFixture();
  const capture = createWeSingCapture({ cachePath: fixture.cachePath, platform: 'win32' });
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  assert.equal(capture.getStatus().cacheReady, false);
  assert.equal((await capture.setCachePath(fixture.cachePath)).cacheReady, true);
});

test('a prepared cache directory that disappears is reported unavailable without restarting the monitor', async (t) => {
  const fixture = createFixture();
  let starts = 0;
  let stops = 0;
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    monitorFactory: () => ({ start() { starts += 1; }, stop() { stops += 1; } }),
    watchFactory: () => ({ close() {} }),
  });
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  await capture.setActive(true);
  const cachePath = path.join(fixture.root, 'missing', 'WeSingCache');
  const prepared = await capture.prepareConfiguration({ cachePath });
  fs.rmdirSync(cachePath);
  const status = await prepared.apply();
  assert.equal(status.cachePath, cachePath);
  assert.equal(status.cacheReady, false);
  assert.equal(status.active, true);
  assert.deepEqual({ starts, stops }, { starts: 1, stops: 0 });
});
