'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createPowerShellWeSingMonitor } = require('../../src/music/wesing-monitor');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function load(file, replacements) {
  const filename = require.resolve(`../../src/music/${file}`);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module'])(
    (id) => replacements[id] || localRequire(id),
    module,
  );
  return module.exports;
}

const cachePath = path.join(os.tmpdir(), 'lira-wesing-lifecycle-synthetic', 'WeSingCache');
const cache = {
  ...require('../../src/music/wesing-cache'),
  ensureWeSingCacheDirectory: async (value) => value,
  createWeSingCacheReader: () => ({
    read: async () => ({ cacheReady: false, log: null, logEntry: null }),
    clear() {},
  }),
  isDirectory: async () => false,
};

function captureFixture(t, overrides = {}, options = {}) {
  const samples = [];
  const states = [];
  const timelines = [];
  const { createWeSingCapture } = load('wesing-capture-engine', {
    './wesing-cache': cache,
    './wesing-qrc-watcher': {
      createWeSingQrcWatcher: () => ({ sync: async () => {}, stop() {} }),
    },
    ...overrides,
  });
  const capture = createWeSingCapture({
    cachePath,
    platform: 'win32',
    now: () => 0,
    onState: (value) => states.push(value),
    onTimeline: (value) => timelines.push(value),
    monitorFactory(callback) {
      samples.push(callback);
      return { start() {}, stop() {} };
    },
    ...options,
  });
  t.after(() => capture.stop());
  return { capture, samples, states, timelines };
}

function monitorChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', null);
  return child;
}

test('WeSing manual detection restarts an exited monitor once and ignores old process callbacks', async (t) => {
  const children = [];
  const f = captureFixture(t, {}, {
    monitorFactory: (callback) => createPowerShellWeSingMonitor(callback, {
      spawn() { const child = monitorChild(); children.push(child); return child; },
    }),
  });
  await f.capture.setActive(true);
  children[0].stdout.write('{"detected":');
  children[0].stderr.write('old process failure');
  children[0].emit('exit', 1);
  assert.equal(f.capture.getStatus().status, 'error');
  await Promise.all([f.capture.refresh(), f.capture.setActive(true)]);
  assert.equal(children.length, 2, 'concurrent manual detection shares the running replacement');
  children[0].emit('error', new Error('late old error'));
  children[0].emit('exit', 1);
  children[0].stdout.write('true,"title":"旧进程"}\n');
  children[1].stdout.write('{"detected":true,"title":"","currentSec":0}\n');
  assert.equal(f.capture.getStatus().platformDetected, true);
  assert.equal(f.capture.getStatus().trackTitle, '');
  assert.equal(f.capture.getStatus().status, 'waiting');
  await f.capture.refresh();
  assert.equal(children.length, 2, 'a late old exit must not clear the replacement process');
  f.capture.stop();
  children[1].stdout.write('{"detected":true,"title":"停止后的样本"}\n');
  await f.capture.refresh();
  assert.equal(children.length, 2, 'refresh after stop must not restart monitoring');
  assert.equal(f.capture.getStatus().active, false);
  assert.equal(f.capture.getStatus().trackTitle, '');
});

for (const failure of ['throw', 'error']) {
  test(`WeSing manual detection recovers from a monitor spawn ${failure}`, async (t) => {
    let spawns = 0;
    const children = [];
    const f = captureFixture(t, {}, {
      monitorFactory: (callback) => createPowerShellWeSingMonitor(callback, {
        spawn() {
          spawns += 1;
          if (spawns === 1 && failure === 'throw') throw new Error('temporary spawn failure');
          const child = monitorChild(); children.push(child); return child;
        },
      }),
    });
    await f.capture.setActive(true);
    if (failure === 'error') children[0].emit('error', new Error('temporary spawn failure'));
    assert.equal(spawns, 1, 'one manual action makes at most one process launch attempt');
    assert.equal(f.capture.getStatus().status, 'error');
    await f.capture.refresh();
    assert.equal(spawns, 2);
    children.at(-1).stdout.write('{"detected":true,"title":""}\n');
    assert.equal(f.capture.getStatus().platformDetected, true);
  });
}

for (const fails of [false, true]) {
  test(`WeSing ignores a superseded cache discovery ${fails ? 'failure' : 'success'}`, async (t) => {
    const pending = deferred();
    let calls = 0;
    const saved = [];
    const f = captureFixture(t, {}, {
      discoverCachePath: () => (++calls === 1 ? pending.promise : ''),
      saveCachePath: (value) => saved.push(value),
    });
    const oldStart = f.capture.setActive(true);
    await new Promise(setImmediate);
    await f.capture.setActive(false);
    await f.capture.setActive(true);
    if (fails) pending.reject(new Error('old directory error'));
    else pending.resolve(cachePath);
    await oldStart;
    assert.equal(f.samples.length, 2);
    assert.deepEqual(saved, []);
    assert.equal(f.capture.getStatus().active, true);
    assert.equal(f.capture.getStatus().status, 'waiting');
    await f.capture.setActive(false);
    await f.capture.setActive(true);
    f.samples[0]({ detected: true, title: '旧监视样本' });
    assert.equal(f.capture.getStatus().trackTitle, '');
  });
}

test('WeSing shares concurrent discovery and persists its unique result once', async (t) => {
  const pending = deferred();
  const discoveredPath = path.join(path.dirname(cachePath), 'found', 'WeSingCache');
  const saved = [];
  let calls = 0;
  const f = captureFixture(t, {}, {
    discoverCachePath: () => { calls += 1; return pending.promise; },
    saveCachePath: (value) => saved.push(value),
  });
  const starting = f.capture.setActive(true);
  const refreshing = f.capture.refresh();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  pending.resolve(discoveredPath);
  await Promise.all([starting, refreshing]);
  assert.deepEqual(saved, [discoveredPath]);
  assert.equal(f.capture.getStatus().cachePath, discoveredPath);
  assert.equal(f.capture.getStatus().cacheReady, true);
});

test('WeSing manual selection wins over pending automatic discovery', async (t) => {
  const pending = deferred();
  const manualPath = path.join(path.dirname(cachePath), 'manual', 'WeSingCache');
  const saved = [];
  const f = captureFixture(t, {}, {
    discoverCachePath: () => pending.promise,
    saveCachePath: (value) => saved.push(value),
  });
  const starting = f.capture.setActive(true);
  await new Promise(setImmediate);
  await f.capture.setCachePath(manualPath);
  pending.resolve(cachePath);
  await starting;
  assert.deepEqual(saved, [manualPath]);
  assert.equal(f.capture.getStatus().cachePath, manualPath);
});

test('WeSing recovers from a failed automatic save through manual configuration', async (t) => {
  let saves = 0;
  const manualPath = path.join(path.dirname(cachePath), 'manual', 'WeSingCache');
  const f = captureFixture(t, {}, {
    discoverCachePath: async () => cachePath,
    saveCachePath: async () => { if (++saves === 1) throw new Error('save failed'); },
  });
  await assert.rejects(f.capture.setActive(true), /save failed/);
  assert.equal(f.capture.getStatus().cacheReady, false);
  await f.capture.setCachePath(manualPath);
  assert.equal(f.capture.getStatus().cachePath, manualPath);
  assert.equal(saves, 2);
});

test('WeSing does not discover on inactive or unsupported captures', async (t) => {
  let calls = 0;
  const f = captureFixture(t, {}, {
    platform: 'linux',
    discoverCachePath: async () => { calls += 1; return cachePath; },
  });
  await f.capture.refresh();
  await f.capture.setActive(true);
  await f.capture.refresh();
  assert.equal(calls, 0);
});

test('WeSing automatically retries a failed cache save on a later monitor sample', async (t) => {
  let timestamp = 0;
  let available = false;
  let attempts = 0;
  const discoveredPath = path.join(path.dirname(cachePath), 'automatic', 'WeSingCache');
  const f = captureFixture(t, {
    './wesing-lyric-resolver': { resolveWeSingLyrics: async () => ({ result: null }) },
  }, {
    now: () => timestamp,
    discoverCachePath: async () => available ? discoveredPath : '',
    saveCachePath: async () => { if (++attempts === 1) throw new Error('temporary save failure'); },
  });
  await f.capture.setActive(true);
  available = true;
  const sample = { detected: true, title: '春泥', currentSec: 1, totalSec: 250 };
  f.samples[0](sample);
  await f.capture.waitForRefresh();
  assert.equal(f.capture.getStatus().cachePath, cachePath);
  timestamp = 3001;
  f.samples[0](sample);
  await f.capture.waitForRefresh();
  assert.equal(f.capture.getStatus().cachePath, discoveredPath);
  assert.equal(attempts, 2);
});

for (const change of ['title', 'stop', 'manual']) {
  test(`WeSing ignores an automatic directory result after ${change} changes`, async (t) => {
    const pending = deferred();
    const saved = [];
    let requests = 0;
    const automaticPath = path.join(path.dirname(cachePath), 'automatic', 'WeSingCache');
    const manualPath = path.join(path.dirname(cachePath), 'manual', 'WeSingCache');
    const f = captureFixture(t, {
      './wesing-lyric-resolver': { resolveWeSingLyrics: async () => ({ result: null }) },
    }, {
      discoverCachePath: () => ++requests === 1 ? '' : pending.promise,
      saveCachePath: (value) => saved.push(value),
    });
    await f.capture.setActive(true);
    f.samples[0]({ detected: true, title: '天若有情', currentSec: 1 });
    const refreshing = f.capture.waitForRefresh();
    await new Promise(setImmediate);
    if (change === 'title') f.samples[0]({ detected: true, title: '春泥', currentSec: 0 });
    if (change === 'stop') f.capture.stop();
    if (change === 'manual') await f.capture.setCachePath(manualPath);
    pending.resolve(automaticPath);
    await refreshing;
    assert.deepEqual(saved, change === 'manual' ? [manualPath] : []);
    assert.equal(f.capture.getStatus().cachePath, change === 'manual' ? manualPath : cachePath);
  });
}

for (const stop of ['disable', 'stop']) {
  test(`WeSing ${stop} invalidates an old lyric result even after reactivation`, async (t) => {
    const pending = deferred();
    let calls = 0;
    const f = captureFixture(t, {
      './wesing-lyric-resolver': {
        resolveWeSingLyrics: () => (++calls === 1 ? pending.promise : Promise.resolve({ result: null })),
      },
    });
    await f.capture.setActive(true);
    f.samples[0]({
      detected: true,
      title: '测试歌曲',
      currentSec: 0,
      totalSec: 8,
    });
    const oldRefresh = f.capture.waitForRefresh();
    if (stop === 'disable') await f.capture.setActive(false);
    else f.capture.stop();
    await f.capture.setActive(true);
    const state = f.capture.getStatus();
    const events = [f.states.length, f.timelines.length];
    pending.resolve({
      result: {
        lines: [{ startMs: 0, endMs: 8000, text: '旧歌词' }],
        artists: [],
        durationMs: 8000,
      },
    });
    await oldRefresh;
    assert.deepEqual(f.capture.getStatus(), state);
    assert.deepEqual([f.states.length, f.timelines.length], events);
  });
}

test('WeSing same-title rendition change invalidates an older lyric request', async (t) => {
  const pending = deferred();
  let onSongChange;
  let calls = 0;
  const lyricResult = (mid) => ({ songMid: mid, result: {
    songMid: mid, artists: [mid], durationMs: 60000,
    lines: [{ startMs: 1000, endMs: 60000, text: mid }],
  } });
  const f = captureFixture(t, {
    './wesing-cache': { ...cache, createWeSingCacheReader: () => ({
      read: async () => ({ cacheReady: false, log: null, logEntry: { mid: 'alin' } }),
      clear() {},
    }) },
    './wesing-qrc-watcher': { createWeSingQrcWatcher(options) {
      onSongChange = options.onSongChange;
      return { sync: async () => {}, stop() {} };
    } },
    './wesing-lyric-resolver': {
      resolveWeSingLyrics: () => ++calls === 1 ? pending.promise : Promise.resolve(lyricResult('alin')),
    },
  });
  await f.capture.setActive(true);
  f.samples[0]({ detected: true, title: '天若有情', currentSec: 30, totalSec: 60 });
  const oldRefresh = f.capture.waitForRefresh();
  onSongChange();
  await f.capture.waitForRefresh();
  const current = f.capture.getStatus();
  assert.equal(current.songMid, 'alin');
  assert.equal(current.currentMs, 0);
  pending.resolve(lyricResult('en'));
  await oldRefresh;
  assert.deepEqual(f.capture.getStatus(), current);
});

test('WeSing manual refresh does not reuse a log entry after the playing title changes', async (t) => {
  const pending = deferred();
  let holdRead = false;
  const snapshot = (title) => ({ cacheReady: true, logEntry: { mid: title, songName: title } });
  const f = captureFixture(t, {
    './wesing-cache': { ...cache, createWeSingCacheReader: () => ({
      read: async (_path, title) => {
        if (holdRead) { holdRead = false; return pending.promise; }
        return snapshot(title);
      },
      clear() {},
    }) },
    './wesing-lyric-resolver': { async resolveWeSingLyrics({ cachePath, title, logEntry, readLogEntry }) {
      const entry = logEntry === undefined ? await readLogEntry(cachePath, title) : logEntry;
      return { songMid: entry.mid, result: { songMid: entry.mid, artists: [], durationMs: 5000,
        lines: [{ startMs: 0, endMs: 5000, text: entry.songName }] } };
    } },
  });
  await f.capture.setActive(true);
  f.samples[0]({ detected: true, title: 'first', currentSec: 0 });
  await f.capture.waitForRefresh();
  holdRead = true;
  const refreshing = f.capture.refresh({ discover: false });
  f.samples[0]({ detected: true, title: 'second', currentSec: 0 });
  await f.capture.waitForRefresh();
  pending.resolve(snapshot('first'));
  await refreshing;
  assert.equal(f.capture.getStatus().songMid, 'second');
  assert.equal(f.capture.getStatus().lyricState.lineText, 'second');
});

test('WeSing watcher cancels pending directory checks and keeps same-path listeners live', async () => {
  const pending = deferred();
  let calls = 0;
  let refreshes = 0;
  let songChecks = 0;
  let closed = 0;
  const events = [];
  const timers = [];
  const { createWeSingQrcWatcher } = load('wesing-qrc-watcher', {
    './wesing-cache': {
      isDirectory: () => (++calls === 1 ? pending.promise : Promise.resolve(true)),
    },
  });
  const watcher = createWeSingQrcWatcher({
    getCachePath: () => cachePath,
    isActive: () => true,
    watchFactory(_path, _options, callback) {
      events.push(callback);
      return {
        close() {
          closed += 1;
        },
      };
    },
    setTimer(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimer() {},
    onRefresh() {
      refreshes += 1;
    },
    onSongChange() { songChecks += 1; },
  });
  try {
    const oldSync = watcher.sync();
    watcher.stop();
    await watcher.sync();
    pending.resolve(true);
    await oldSync;
    assert.equal(events.length, 1);
    await watcher.sync();
    events[0]('change', 'song.qrc');
    timers[0]();
    assert.equal(refreshes, 1);
    events[0]('change', 'song.qrc');
    watcher.stop();
    await watcher.sync();
    events[0]('change', 'old.qrc');
    timers[1]();
    assert.equal(refreshes, 1);
    assert.equal(timers.length, 2);
    assert.equal(closed, 1);
    events[1]('change', 'Log\\WeSing\\song.log');
    events[1]('change', 'Log\\WeSing\\song.log');
    assert.equal(timers.length, 3, 'continuous log writes do not postpone the scheduled check');
    timers[2]();
    assert.equal(songChecks, 1);
    events[1]('change', 'Log\\WeSing\\song.log');
    watcher.stop();
    timers[3]();
    assert.equal(songChecks, 1, 'stopped log callbacks cannot refresh a new capture');
  } finally {
    watcher.stop();
  }
});
