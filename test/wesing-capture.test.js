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
    `event "StartKSong" payload {"mid":"${mid}","songname":"测试歌曲"}`
  ].join('\r\n'), 'utf16le'));

  const content = '[ti:测试歌曲]\n[ar:测试歌手]\n[1000,1800]你(1000,800)好(1800,1000)\n[4000,1200]世(4000,600)界(4600,600)';
  const encrypted = Buffer.from(encryptQrc(qrcXml(content)), 'hex');
  fs.writeFileSync(path.join(qrcDir, `${mid}.qrc`), Buffer.concat([
    Buffer.from('[offset:0]\n', 'utf8'),
    encrypted
  ]));
  return { root, cachePath, mid };
}

test('WeSing cache parser reads matching UTF-16LE log and decrypts local word-timed QRC', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const entry = await findLatestSongEntry(fixture.cachePath, '测试歌曲');
  assert.deepEqual(entry, { mid: fixture.mid, songName: '测试歌曲' });

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

  currentTime = 4000;
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: -1, totalSec: -1 });
  state = capture.getStatus();
  assert.equal(state.lyricState.currentMs, 4130);
  assert.equal(state.lyricState.lineText, '世界');
  assert.equal(state.lyricState.playing, true);

  currentTime = 4250;
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 4, totalSec: 8 });
  state = capture.getStatus();
  assert.equal(state.lyricState.lineText, '世界');
  assert.equal(states.length > 2, true);

  await capture.setActive(false);
  assert.equal(stopped, true);
  assert.equal(capture.getStatus().active, false);
});

test('WeSing capture keeps a monotonic clock while UI Automation progress is unavailable', async () => {
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
  assert.equal(state.playing, true);

  currentTime = 2250;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
  state = capture.getStatus();
  assert.equal(state.currentMs, 1250);
  assert.equal(state.playing, true);

  currentTime = 2500;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 2, totalSec: 255 });
  state = capture.getStatus();
  assert.equal(state.currentMs, 2130);
  assert.equal(state.durationMs, 255000);
  assert.equal(state.playing, true);
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
  currentTime = 2000;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 10, totalSec: 255 });
  assert.equal(capture.getStatus().playing, true);

  currentTime = 2600;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: 10, totalSec: 255 });
  const pausedAt = capture.getStatus().currentMs;
  assert.equal(pausedAt, 11730);
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
  currentTime = 1750;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
  assert.equal(capture.getStatus().currentMs, 20880);

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
  currentTime = 1500;
  onSample({ detected: false, title: '', currentSec: -1, totalSec: -1 });
  assert.equal(capture.getStatus().currentMs, 5630);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 2500;
  onSample({ detected: true, title: '全民K歌 - 失控', currentSec: -1, totalSec: -1 });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, true);

  currentTime = 3000;
  onSample({ error: 'UI Automation stopped' });
  const failedState = capture.getStatus();
  assert.equal(failedState.currentMs, 500);
  assert.equal(failedState.playing, false);
  assert.equal(failedState.lyricState.playing, false);
  assert.equal(failedState.status, 'error');
});

test('WeSing capture falls back to injected online lyrics when local QRC is absent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-online-'));
  const cachePath = path.join(root, 'WeSingCache');
  fs.mkdirSync(cachePath, { recursive: true });
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
  assert.deepEqual(requested, [{ title: '失控', durationMs: 255000 }]);
  assert.equal(timelines.filter((timeline) => timeline.lines.length > 0).length, 1);
  assert.equal(timelines.at(-1).trackTitle, '失控');
  assert.equal(timelines.at(-1).lines[0].text, '请原谅我的词穷');
});

test('WeSing monitor uses Now Playing polling cadence', () => {
  assert.match(buildPowerShellMonitorScript(), /Start-Sleep -Milliseconds 100/);
});
