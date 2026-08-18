'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { encryptQrc } = require('qrc-decoder');

const {
  buildPowerShellMonitorScript,
  createWeSingCapture,
  findLatestSongEntry,
  loadWeSingLyrics,
  normalizeWeSingCachePath
} = require('../src/music/wesing-capture');

function qrcXml(content, options = {}) {
  const saveTime = options.saveTime || 8;
  return `<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos><LyricInfo SaveTime="${saveTime}"><Lyric_1 LyricType="1" LyricContent="${content}"/></LyricInfo></QrcInfos>`;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-cache-'));
  const cachePath = path.join(root, 'WeSingCache');
  const mid = 'safe_mid-123';
  const logDir = path.join(cachePath, 'Log', 'WeSing');
  const qrcDir = path.join(cachePath, 'WeSingDL', 'Res', mid);
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(qrcDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'WeSing-1.log'), Buffer.from([
    'ignored line',
    'event "StartKSong" payload {"mid":"older","songname":"旧歌"}',
    `event "StartKSong" payload {"mid":"${mid}","songname":"测试歌曲","singer":"测试歌手"}`
  ].join('\r\n'), 'utf16le'));

  const content = '[ti:测试歌曲]\n[ar:测试歌手]\n[1000,1800]你(1000,800)好(1800,1000)\n[4000,1200]世(4000,600)界(4600,600)';
  const encrypted = Buffer.from(encryptQrc(qrcXml(content)), 'hex');
  fs.writeFileSync(path.join(qrcDir, `${mid}.qrc`), Buffer.concat([
    Buffer.from('[offset:0]\n', 'utf8'),
    encrypted
  ]));
  return { root, cachePath, mid };
}

test('WeSing capture facade preserves focused module exports', () => {
  const facade = require('../src/music/wesing-capture');
  const engine = require('../src/music/wesing-capture-engine');
  const cache = require('../src/music/wesing-cache');
  const monitor = require('../src/music/wesing-monitor');

  assert.equal(facade.createWeSingCapture, engine.createWeSingCapture);
  assert.equal(facade.loadWeSingLyrics, cache.loadWeSingLyrics);
  assert.equal(facade.buildPowerShellMonitorScript, monitor.buildPowerShellMonitorScript);
});

test('WeSing cache parser reads matching UTF-16LE log and decrypts local word-timed QRC', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const entry = await findLatestSongEntry(fixture.cachePath, '测试歌曲');
  assert.deepEqual(entry, { mid: fixture.mid, songName: '测试歌曲', artist: '测试歌手' });

  const result = await loadWeSingLyrics({
    cachePath: fixture.cachePath,
    title: '测试歌曲'
  });
  assert.equal(result.songMid, fixture.mid);
  assert.equal(result.title, '测试歌曲');
  assert.deepEqual(result.artists, ['测试歌手']);
  assert.equal(result.durationMs, 8000);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].text, '你好');
  assert.deepEqual(result.lines[0].words, [
    { text: '你', startMs: 1000, endMs: 1800 },
    { text: '好', startMs: 1800, endMs: 2800 }
  ]);
});

test('WeSing log parser ignores title mismatches and unsafe song IDs', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const logPath = path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-2.log');
  fs.writeFileSync(logPath, Buffer.from(
    'event "StartKSong" payload {"mid":"..\\..\\secret","songname":"测试歌曲"}',
    'utf16le'
  ));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(logPath, future, future);

  assert.equal(await findLatestSongEntry(fixture.cachePath, '另一首歌'), null);
  assert.equal(await findLatestSongEntry(fixture.cachePath, '测试歌曲'), null);
  assert.throws(() => normalizeWeSingCachePath('relative\\WeSingCache'), /绝对路径/);
  assert.throws(() => normalizeWeSingCachePath('C:\\Temp\\OtherFolder'), /WeSingCache/);
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
        start() { cacheExistedAtMonitorStart = fs.existsSync(cachePath); },
        stop() {}
      };
    }
  });
  t.after(() => capture.stop());

  const status = await capture.setActive(true);

  assert.equal(status.active, true);
  assert.equal(cacheExistedAtMonitorStart, true);
});

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
        stop() { stopped = true; }
      };
    },
    onState(state) { states.push(state); }
  });

  await capture.setActive(true);
  assert.equal(typeof onSample, 'function');
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 1, totalSec: 8 });
  await capture.waitForRefresh();

  let state = capture.getStatus();
  assert.equal(state.active, true);
  assert.equal(state.platformDetected, true);
  assert.equal(state.trackTitle, '测试歌曲');
  assert.equal(state.lyricState.lineText, '你好');
  assert.equal(state.lyricState.playing, true);
  assert.equal(state.lyricState.words.length, 2);

  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 2, totalSec: 8 });
  state = capture.getStatus();
  assert.equal(state.lyricState.playing, true);

  currentTime = 4000;
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: -1, totalSec: -1 });
  state = capture.getStatus();
  assert.equal(state.lyricState.currentMs, 5030);
  assert.equal(state.lyricState.lineText, '世界');
  assert.equal(state.lyricState.playing, false);

  currentTime = 4250;
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 4, totalSec: 8 });
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
    }
  });

  await capture.setActive(true);
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
  let state = capture.getStatus();
  assert.equal(state.currentMs, 0);
  assert.equal(state.playing, false);
  assert.equal(state.waitingForPlayback, true);

  currentTime = 2250;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
  state = capture.getStatus();
  assert.equal(state.currentMs, 0);
  assert.equal(state.playing, false);

  currentTime = 2500;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 2, totalSec: 255 });
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
    }
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 0,
    totalSec: 255,
    loading: true
  });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2000;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1, loading: false });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2250;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1, loading: false });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2300;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 0, totalSec: 255, loading: false });
  assert.equal(capture.getStatus().currentMs, 130);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 3200;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 1, totalSec: 255, loading: false });
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
        lines: [{
          startMs: 0,
          endMs: durationMs,
          text: loaded ? '正确歌词' : '错误歌词',
          words: []
        }]
      };
    }
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 同名歌曲',
    currentSec: 0,
    totalSec: 180,
    loading: true
  });
  await capture.waitForRefresh();
  assert.deepEqual(capture.getStatus().lyricState.artists, ['错误歌手']);

  onSample({
    detected: true,
    title: '全民K歌 - 同名歌曲',
    currentSec: 0,
    totalSec: 200,
    loading: false
  });
  assert.deepEqual(requestedDurations, [180000]);

  onSample({
    detected: true,
    title: '全民K歌 - 同名歌曲',
    currentSec: 1,
    totalSec: 200,
    loading: false
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
    }
  });

  await capture.setActive(true);
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 10, totalSec: 255 });
  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 11, totalSec: 255 });
  assert.equal(capture.getStatus().playing, true);

  currentTime = 2700;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 11, totalSec: 255 });
  const pausedAt = capture.getStatus().currentMs;
  assert.equal(pausedAt, 12730);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 3600;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
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
    }
  });

  await capture.setActive(true);
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 20, totalSec: 255 });
  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 21, totalSec: 255 });
  currentTime = 1750;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
  assert.equal(capture.getStatus().currentMs, 21780);

  currentTime = 2000;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 2, totalSec: 255 });
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
    }
  });

  await capture.setActive(true);
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 5, totalSec: 255 });
  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 6, totalSec: 255 });
  currentTime = 1500;
  onSample({ detected: false, title: '', currentSec: -1, totalSec: -1 });
  assert.equal(capture.getStatus().currentMs, 6530);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2500;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
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

test('WeSing capture falls back to injected online lyrics when local QRC is absent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-online-'));
  const cachePath = path.join(root, 'WeSingCache');
  fs.mkdirSync(cachePath, { recursive: true });
  const logDir = path.join(cachePath, 'Log', 'WeSing');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'WeSing-online.log'),
    Buffer.from('event "StartKSong" payload {"mid":"online-mid","songname":"失控","artist":"井迪"}', 'utf16le')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let onSample = null;
  const requested = [];
  const timelines = [];
  const capture = createWeSingCapture({
    cachePath,
    platform: 'win32',
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
    onTimeline(timeline) {
      timelines.push(timeline);
    },
    async resolveFallbackLyrics(input) {
      requested.push(input);
      return {
        source: 'qq',
        songMid: 'qq_mid',
        title: input.title,
        artists: ['井迪'],
        durationMs: input.durationMs,
        lines: [{
          startMs: 0,
          endMs: 2000,
          text: '请原谅我的词穷',
          words: [{ text: '请', startMs: 0, endMs: 200 }]
        }]
      };
    }
  });

  await capture.setActive(true);
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 1, totalSec: 255 });
  await capture.waitForRefresh();

  const state = capture.getStatus();
  assert.equal(state.cacheReady, false);
  assert.equal(state.qrcReady, true);
  assert.equal(state.lyricSource, 'qq');
  assert.equal(state.lyricState.lineText, '请原谅我的词穷');
  assert.deepEqual(requested, [{
    title: '失控',
    artist: '井迪',
    artists: ['井迪'],
    durationMs: 255000
  }]);
  assert.equal(timelines.filter((timeline) => timeline.lines.length > 0).length, 1);
  assert.equal(timelines.at(-1).trackTitle, '失控');
  assert.equal(timelines.at(-1).lines[0].text, '请原谅我的词穷');
  await capture.setActive(false);
});

test('WeSing monitor uses Now Playing polling cadence', () => {
  const script = buildPowerShellMonitorScript();
  assert.match(script, /Start-Sleep -Milliseconds 100/);
  assert.match(script, /loading = \$false/);
  assert.match(script, /\\u6b4c\\u66f2\\u52a0\\u8f7d\\u4e2d/);
});

test('WeSing monitor finds hidden playback windows and reports audio activity', () => {
  const script = buildPowerShellMonitorScript();
  assert.match(script, /EnumWindows/);
  assert.match(script, /AccessibleObjectFromWindow/);
  assert.match(script, /GetAccessiblePlaybackSnapshot/);
  assert.match(script, /progressSource = 'msaa'/);
  assert.match(script, /IAudioSessionManager2/);
  assert.match(script, /IAudioMeterInformation/);
  assert.match(script, /audioActive/);
  assert.match(script, /audioPeak/);
  assert.match(script, /windowHandle/);
  assert.match(script, /AutomationElement\]::FromHandle/);
});

test('WeSing capture refreshes a late QRC without resetting the playback clock', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let onSample = null;
  let watchCallback = null;
  let watcherClosed = false;
  let scheduledRefresh = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
    watchFactory(directoryPath, options, callback) {
      assert.equal(directoryPath, fixture.cachePath);
      assert.equal(options.recursive, true);
      watchCallback = callback;
      return { close() { watcherClosed = true; } };
    },
    setTimer(callback, delayMs) {
      scheduledRefresh = { callback, delayMs };
      return 1;
    },
    clearTimer() {
      scheduledRefresh = null;
    }
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: -1,
    totalSec: 8,
    audioActive: true
  });
  await capture.waitForRefresh();
  assert.equal(typeof watchCallback, 'function');

  currentTime = 3000;
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: -1,
    totalSec: 8,
    audioActive: true
  });
  const beforeRefreshMs = capture.getStatus().currentMs;

  const replacement = Buffer.from(encryptQrc(qrcXml(
    '[ti:测试歌曲]\n[ar:测试歌手]\n[0,1200]新(0,600)词(600,600)',
    { saveTime: 8 }
  )), 'hex');
  fs.writeFileSync(
    path.join(fixture.cachePath, 'WeSingDL', 'Res', fixture.mid, `${fixture.mid}.qrc`),
    replacement
  );
  watchCallback('change', path.join('WeSingDL', 'Res', fixture.mid, `${fixture.mid}.qrc`));
  assert.equal(scheduledRefresh.delayMs, 2000);
  scheduledRefresh.callback();
  await capture.waitForRefresh();

  const state = capture.getStatus();
  assert.equal(state.currentMs, beforeRefreshMs, '歌词刷新不能重置播放时钟');
  assert.equal(state.lyricState.lineText, '新词');

  await capture.setActive(false);
  assert.equal(watcherClosed, true);
});

test('WeSing lyric offset is validated, persisted, and applied without changing raw progress', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let onSample = null;
  const savedOffsets = [];
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    lyricOffsetMs: -500,
    saveLyricOffsetMs(value) { savedOffsets.push(value); },
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    }
  });

  await capture.setActive(true);
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 4, totalSec: 8 });
  await capture.waitForRefresh();

  let state = capture.getStatus();
  assert.equal(state.currentMs, 4130);
  assert.equal(state.lyricOffsetMs, -500);
  assert.equal(state.lyricState.currentMs, 3630);
  assert.equal(state.lyricState.lineText, '你好');

  state = await capture.setLyricOffsetMs(250);
  assert.equal(state.currentMs, 4130);
  assert.equal(state.lyricState.currentMs, 4380);
  assert.equal(state.lyricState.lineText, '世界');
  assert.deepEqual(savedOffsets, [250]);
  state = await capture.setLyricOffsetMs(3000);
  assert.equal(state.lyricOffsetMs, 3000);
  await assert.rejects(capture.setLyricOffsetMs(3001), /-3000.*3000/);
  await assert.rejects(capture.setLyricOffsetMs('not-a-number'), /数字/);
});
