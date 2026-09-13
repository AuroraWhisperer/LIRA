'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createWeSingCapture } = require('../src/music/wesing-capture');
const { createFixture } = require('./helpers/wesing-capture-fixture');

test('WeSing capture activates an injected monitor and derives live lyric state', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let onSample = null;
  let stopped = false;
  let currentTime = 1000;
  const states = [];
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return {
        start() {},
        stop() {
          stopped = true;
        },
      };
    },
    onState(state) {
      states.push(state);
    },
  });

  await capture.setActive(true);
  assert.equal(typeof onSample, 'function');
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: 1,
    totalSec: 8,
  });
  await capture.waitForRefresh();

  let state = capture.getStatus();
  assert.equal(state.active, true);
  assert.equal(state.platformDetected, true);
  assert.equal(state.trackTitle, '测试歌曲');
  assert.equal(state.lyricState.lineText, '你好');
  assert.equal(state.lyricState.playing, true);
  assert.equal(state.lyricState.words.length, 2);

  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: 2,
    totalSec: 8,
  });
  state = capture.getStatus();
  assert.equal(state.lyricState.playing, true);

  currentTime = 4000;
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: -1,
    totalSec: -1,
  });
  state = capture.getStatus();
  assert.equal(state.lyricState.currentMs, 5030);
  assert.equal(state.lyricState.lineText, '世界');
  assert.equal(state.lyricState.playing, false);

  currentTime = 4250;
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: 4,
    totalSec: 8,
  });
  state = capture.getStatus();
  assert.equal(state.lyricState.lineText, '世界');
  assert.equal(states.length > 2, true);

  await capture.setActive(false);
  assert.equal(stopped, true);
  assert.equal(capture.getStatus().active, false);
});

test('WeSing capture stays paused until progress text becomes available', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: -1,
    totalSec: -1,
  });
  let state = capture.getStatus();
  assert.equal(state.currentMs, 0);
  assert.equal(state.playing, false);
  assert.equal(state.waitingForPlayback, true);

  currentTime = 2250;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: -1,
    totalSec: -1,
  });
  state = capture.getStatus();
  assert.equal(state.currentMs, 0);
  assert.equal(state.playing, false);

  currentTime = 2500;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 2,
    totalSec: 255,
  });
  state = capture.getStatus();
  assert.equal(state.currentMs, 2130);
  assert.equal(state.durationMs, 255000);
  assert.equal(state.playing, true);
});

test('WeSing capture waits for measured progress after the client finishes loading', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 0,
    totalSec: 255,
    loading: true,
  });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2000;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: -1,
    totalSec: -1,
    loading: false,
  });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2250;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: -1,
    totalSec: -1,
    loading: false,
  });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2300;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 0,
    totalSec: 255,
    loading: false,
  });
  assert.equal(capture.getStatus().currentMs, 130);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 3200;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 1,
    totalSec: 255,
    loading: false,
  });
  assert.equal(capture.getStatus().currentMs, 1130);
  assert.equal(capture.getStatus().playing, true);
});

test('WeSing capture delays the forced lyric refresh until one second after playback starts', async () => {
  let onSample = null;
  const requestedDurations = [];
  const timers = [];
  const capture = createWeSingCapture({
    platform: 'win32',
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
    setTimer(callback, delayMs) {
      const timer = { callback, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
    async resolveFallbackLyrics({ title, durationMs }) {
      requestedDurations.push(durationMs);
      const loaded = durationMs === 200000;
      return {
        source: 'qq',
        songMid: loaded ? 'correct_mid' : 'stale_mid',
        title,
        artists: [loaded ? '正确歌手' : '错误歌手'],
        durationMs,
        lines: [
          {
            startMs: 0,
            endMs: durationMs,
            text: loaded ? '正确歌词' : '错误歌词',
            words: [],
          },
        ],
      };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 同名歌曲',
    currentSec: 0,
    totalSec: 180,
    loading: true,
  });
  await capture.waitForRefresh();
  assert.deepEqual(capture.getStatus().lyricState.artists, ['错误歌手']);

  onSample({
    detected: true,
    title: '全民K歌 - 同名歌曲',
    currentSec: 0,
    totalSec: 200,
    loading: false,
  });
  assert.deepEqual(requestedDurations, [180000]);

  onSample({
    detected: true,
    title: '全民K歌 - 同名歌曲',
    currentSec: 1,
    totalSec: 200,
    loading: false,
  });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 1000);

  timers[0].callback();
  await capture.waitForRefresh();

  let state = capture.getStatus();
  assert.deepEqual(requestedDurations, [180000, 200000]);
  assert.equal(state.songMid, 'correct_mid');
  assert.deepEqual(state.lyricState.artists, ['正确歌手']);
  assert.equal(state.lyricState.lineText, '正确歌词');
  assert.equal(state.playing, true);

  await capture.setActive(false);
});

test('WeSing capture freezes on a confirmed pause and preserves it through unavailable samples', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 10,
    totalSec: 255,
  });
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 11,
    totalSec: 255,
  });
  assert.equal(capture.getStatus().playing, true);

  currentTime = 2700;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 11,
    totalSec: 255,
  });
  const pausedAt = capture.getStatus().currentMs;
  assert.equal(pausedAt, 12730);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 3600;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: -1,
    totalSec: -1,
  });
  assert.equal(capture.getStatus().currentMs, pausedAt);
  assert.equal(capture.getStatus().playing, false);
});

test('WeSing capture accepts backward progress as replay or seek calibration', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 20,
    totalSec: 255,
  });
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 21,
    totalSec: 255,
  });
  currentTime = 1750;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: -1,
    totalSec: -1,
  });
  assert.equal(capture.getStatus().currentMs, 21780);

  currentTime = 2000;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 2,
    totalSec: 255,
  });
  assert.equal(capture.getStatus().currentMs, 2130);
  assert.equal(capture.getStatus().playing, true);
});

test('WeSing capture restarts timing after the client returns and freezes on monitor errors', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 5,
    totalSec: 255,
  });
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 6,
    totalSec: 255,
  });
  currentTime = 1500;
  onSample({ detected: false, title: '', currentSec: -1, totalSec: -1 });
  assert.equal(capture.getStatus().currentMs, 6530);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2500;
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: -1,
    totalSec: -1,
  });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 3000;
  onSample({ error: 'UI Automation stopped' });
  const failedState = capture.getStatus();
  assert.equal(failedState.currentMs, 0);
  assert.equal(failedState.playing, false);
  assert.equal(failedState.lyricState.playing, false);
  assert.equal(failedState.status, 'error');
});
