'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createWeSingDiagnostics } = require('../../src/music/wesing-diagnostics');
const { startTimedCapture } = require('../helpers/wesing-capture-fixture');
const { createScratchDirectory } = require('../helpers/scratch-directory');

function fixture(logDir) {
  let timestamp = 0;
  const timers = new Map();
  const state = { trackTitle: '合成歌曲', qrcReady: true, cacheReady: true, lyricSource: 'wesing',
    currentMs: 5000, durationMs: 200000, lyricLineCount: 10, firstLineStartMs: 15000,
    cachePath: 'private-path', token: 'private-token' };
  const diagnostics = createWeSingDiagnostics({ now: () => timestamp, logDir,
    getSnapshot: () => state,
    setTimer(fn, delay) { timers.set(fn, delay); return fn; },
    clearTimer(fn) { timers.delete(fn); },
  });
  return { diagnostics, state, timers,
    record(time, sample = {}, audible = false) {
      timestamp = time;
      diagnostics.record({ detected: true, currentSec: 5, totalSec: 200, audioActive: false,
        audioPeak: 0, outputDeviceCount: 2, audioSessionCount: 1, activeAudioSessionCount: 0, ...sample }, audible);
    },
    finish() { timestamp = 20000; [...timers.keys()][0](); },
  };
}

test('WeSing diagnostic samples are bounded, shared and exclude private input', async () => {
  const f = fixture();
  const pending = f.diagnostics.start();
  assert.equal(f.diagnostics.start(), pending);
  assert.deepEqual([...f.timers.values()], [20000]);
  for (let time = 0; time <= 21000; time += 10) {
    f.record(time, { token: 'secret', controls: [{ name: 'private' }], error: 'private-path' });
  }
  f.finish();
  const result = await pending;
  assert.equal(result.samples.length, 80);
  assert.equal(result.samples.at(-1).elapsedMs, 19750);
  assert.equal(result.summary.result, 'monitor-error');
  assert.equal(f.timers.size, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret|private|cachePath|controls|token/);
});

test('WeSing diagnostic distinguishes loaded lyrics from stalled playback', async () => {
  const f = fixture();
  const pending = f.diagnostics.start();
  f.record(0); f.record(19000); f.finish();
  const result = await pending;
  assert.equal(result.summary.result, 'playback-stalled');
  assert.equal(result.final.lyricsReady, true);
  assert.equal(result.summary.clockAdvanced, false);
  assert.equal(result.summary.audible, false);
  assert.equal(result.summary.outputDeviceCount, 2);
});

test('WeSing diagnostic accepts an audio-driven clock despite frozen UI progress', async () => {
  const f = fixture();
  const pending = f.diagnostics.start();
  const audio = { audioActive: true, audioPeak: 0.2, activeAudioSessionCount: 1 };
  f.record(0, audio, true);
  f.state.currentMs = 24000; f.state.hasCurrentLine = true; f.state.playing = true;
  f.record(19000, audio, true); f.finish();
  const result = await pending;
  assert.equal(result.summary.result, 'ready');
  assert.equal(result.summary.progressAdvanced, false);
  assert.equal(result.summary.clockAdvanced, true);
  assert.equal(result.summary.audible, true);
  assert.equal(result.summary.activeAudioSessionCount, 1);
});

test('WeSing diagnostic reports missing samples and interruption, then allows another run', async () => {
  const f = fixture();
  const first = f.diagnostics.start(); f.finish();
  assert.equal((await first).summary.result, 'no-samples');
  const next = f.diagnostics.start();
  f.diagnostics.stop(); f.diagnostics.stop();
  assert.equal((await next).summary.result, 'interrupted');
  assert.equal(f.timers.size, 0);
});

test('WeSing diagnostic distinguishes prelude, missing lyrics and song changes', async () => {
  for (const expected of ['intro', 'lyrics-missing', 'track-changed', 'client-missing']) {
    const f = fixture();
    const pending = f.diagnostics.start();
    f.record(0, { detected: expected !== 'client-missing' });
    f.state.currentMs = 10000;
    if (expected === 'lyrics-missing') f.state.qrcReady = false;
    if (expected === 'track-changed') f.state.trackTitle = '另一首';
    f.record(19000, { detected: expected !== 'client-missing', currentSec: 10 }); f.finish();
    assert.equal((await pending).summary.result, expected);
  }
});

test('WeSing capture diagnostics reuse its monitor and settle when capture stops', async (t) => {
  let timestamp = 0;
  let starts = 0;
  const timers = new Map();
  let emit;
  const { capture } = await startTimedCapture(t, () => timestamp, {
    monitorFactory(callback) { emit = callback; return { start() { starts++; }, stop() {} }; },
    setTimer(fn, delay) { timers.set(fn, delay); return fn; },
    clearTimer(fn) { timers.delete(fn); },
  });
  const pending = capture.diagnose();
  emit({ detected: true, title: '全民K歌 - 合成歌曲', currentSec: 5, totalSec: 200, audioActive: false });
  timestamp = 1000;
  emit({ detected: true, title: '全民K歌 - 合成歌曲', currentSec: 5, totalSec: 200, audioActive: true, audioPeak: 0.2 });
  capture.stop();
  const result = await pending;
  assert.equal(starts, 1);
  assert.equal(result.samples.length, 2);
  assert.equal(result.samples[1].audible, true);
  assert.equal(result.summary.result, 'interrupted');
  assert.equal(timers.size, 0);
  assert.throws(() => capture.diagnose(), /请先打开/);
});

test('WeSing diagnostic export writes the owned report to logs with an English purpose and local time', async (t) => {
  const directory = createScratchDirectory('wesing-diagnostic-export-', t);
  const logDir = path.join(directory, 'logs');
  const date = new Date(2026, 9, 15, 20, 30, 0, 123);
  t.mock.timers.enable({ apis: ['Date'], now: date.getTime() });
  const f = fixture(logDir);
  await assert.rejects(f.diagnostics.exportReport('not-a-report'), /重新运行/);
  const pending = f.diagnostics.start();
  f.record(0); f.finish();
  const report = await pending;
  await assert.rejects(fs.access(logDir), { code: 'ENOENT' }, 'finishing diagnosis must not write a file');
  await assert.rejects(f.diagnostics.exportReport('../../other.json'), /重新运行/);
  const saved = await f.diagnostics.exportReport(report.startedAt);
  assert.equal(saved.path, path.join(logDir, 'wesing-playback-diagnostic-2026-10-15_20-30-00-123.json'));
  assert.deepEqual(JSON.parse(await fs.readFile(saved.path, 'utf8')), report);
  await fs.writeFile(saved.path, 'existing file must not be overwritten');
  await assert.rejects(f.diagnostics.exportReport(report.startedAt), /同名诊断文件已存在/);
  assert.equal(await fs.readFile(saved.path, 'utf8'), 'existing file must not be overwritten');
  t.mock.timers.tick(1);
  const next = f.diagnostics.start(); f.finish(); await next;
  await assert.rejects(f.diagnostics.exportReport(report.startedAt), /重新运行/);
});

test('WeSing diagnostic export reports write failure and allows retry', async (t) => {
  const directory = createScratchDirectory('wesing-diagnostic-export-failure-', t);
  const logDir = path.join(directory, 'logs');
  const f = fixture(logDir);
  const pending = f.diagnostics.start(); f.finish();
  const report = await pending;
  await fs.writeFile(logDir, 'blocking file');
  await assert.rejects(f.diagnostics.exportReport(report.startedAt), /日志文件夹权限/);
  await fs.unlink(logDir);
  const saved = await f.diagnostics.exportReport(report.startedAt);
  assert.deepEqual(JSON.parse(await fs.readFile(saved.path, 'utf8')), report);
});
