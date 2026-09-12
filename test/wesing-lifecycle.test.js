'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function load(file, replacements) {
  const filename = require.resolve(`../src/music/${file}`);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module'])(
    (id) => replacements[id] || localRequire(id), module,
  );
  return module.exports;
}

const cachePath = path.join(os.tmpdir(), 'lira-wesing-lifecycle-synthetic', 'WeSingCache');
const cache = {
  ...require('../src/music/wesing-cache'),
  ensureWeSingCacheDirectory: async () => cachePath,
  isDirectory: async () => false,
};

function captureFixture(t, overrides = {}) {
  const samples = [];
  const states = [];
  const timelines = [];
  const { createWeSingCapture } = load('wesing-capture-engine', {
    './wesing-cache': cache,
    './wesing-qrc-watcher': { createWeSingQrcWatcher: () => ({ sync: async () => {}, stop() {} }) },
    ...overrides,
  });
  const capture = createWeSingCapture({
    cachePath, platform: 'win32', now: () => 0,
    onState: (value) => states.push(value),
    onTimeline: (value) => timelines.push(value),
    monitorFactory(callback) { samples.push(callback); return { start() {}, stop() {} }; },
  });
  t.after(() => capture.stop());
  return { capture, samples, states, timelines };
}

for (const fails of [false, true]) {
  test(`WeSing ignores a superseded directory creation ${fails ? 'failure' : 'success'}`, async (t) => {
    const pending = deferred();
    let calls = 0;
    const f = captureFixture(t, { './wesing-cache': { ...cache, ensureWeSingCacheDirectory: () => ++calls === 1 ? pending.promise : cachePath } });
    const oldStart = f.capture.setActive(true);
    await f.capture.setActive(false);
    await f.capture.setActive(true);
    if (fails) pending.reject(new Error('old directory error'));
    else pending.resolve(cachePath);
    await oldStart;
    assert.equal(f.samples.length, 1);
    assert.equal(f.capture.getStatus().active, true);
    assert.equal(f.capture.getStatus().status, 'waiting');
    await f.capture.setActive(false);
    await f.capture.setActive(true);
    f.samples[0]({ detected: true, title: '旧监视样本' });
    assert.equal(f.capture.getStatus().trackTitle, '');
  });
}

for (const stop of ['disable', 'stop']) {
  test(`WeSing ${stop} invalidates an old lyric result even after reactivation`, async (t) => {
    const pending = deferred();
    let calls = 0;
    const f = captureFixture(t, {
      './wesing-lyric-resolver': { resolveWeSingLyrics: () => ++calls === 1 ? pending.promise : Promise.resolve({ result: null }) },
    });
    await f.capture.setActive(true);
    f.samples[0]({ detected: true, title: '测试歌曲', currentSec: 0, totalSec: 8 });
    const oldRefresh = f.capture.waitForRefresh();
    if (stop === 'disable') await f.capture.setActive(false);
    else f.capture.stop();
    await f.capture.setActive(true);
    const state = f.capture.getStatus();
    const events = [f.states.length, f.timelines.length];
    pending.resolve({ result: { lines: [{ startMs: 0, endMs: 8000, text: '旧歌词' }], artists: [], durationMs: 8000 } });
    await oldRefresh;
    assert.deepEqual(f.capture.getStatus(), state);
    assert.deepEqual([f.states.length, f.timelines.length], events);
  });
}

test('WeSing watcher cancels pending directory checks and keeps same-path listeners live', async () => {
  const pending = deferred();
  let calls = 0;
  let refreshes = 0;
  let closed = 0;
  const events = [];
  const timers = [];
  const { createWeSingQrcWatcher } = load('wesing-qrc-watcher', {
    './wesing-cache': { isDirectory: () => ++calls === 1 ? pending.promise : Promise.resolve(true) },
  });
  const watcher = createWeSingQrcWatcher({
    getCachePath: () => cachePath, isActive: () => true,
    watchFactory(_path, _options, callback) { events.push(callback); return { close() { closed += 1; } }; },
    setTimer(callback) { timers.push(callback); return timers.length; }, clearTimer() {},
    onRefresh() { refreshes += 1; },
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
  } finally { watcher.stop(); }
});
