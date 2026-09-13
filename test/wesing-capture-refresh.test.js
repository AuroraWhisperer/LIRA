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
} = require('../src/music/wesing-capture');
const { createFixture, qrcXml } = require('./helpers/wesing-capture-fixture');

test('WeSing capture falls back to injected online lyrics when local QRC is absent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-online-'));
  const cachePath = path.join(root, 'WeSingCache');
  fs.mkdirSync(cachePath, { recursive: true });
  const logDir = path.join(cachePath, 'Log', 'WeSing');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'WeSing-online.log'),
    Buffer.from(
      'event "StartKSong" payload {"mid":"online-mid","songname":"失控","artist":"井迪"}',
      'utf16le',
    ),
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
        lines: [
          {
            startMs: 0,
            endMs: 2000,
            text: '请原谅我的词穷',
            words: [{ text: '请', startMs: 0, endMs: 200 }],
          },
        ],
      };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 失控',
    currentSec: 1,
    totalSec: 255,
  });
  await capture.waitForRefresh();

  const state = capture.getStatus();
  assert.equal(state.cacheReady, false);
  assert.equal(state.qrcReady, true);
  assert.equal(state.lyricSource, 'qq');
  assert.equal(state.lyricState.lineText, '请原谅我的词穷');
  assert.deepEqual(requested, [
    {
      title: '失控',
      artist: '井迪',
      artists: ['井迪'],
      durationMs: 255000,
    },
  ]);
  assert.equal(
    timelines.filter((timeline) => timeline.lines.length > 0).length,
    1,
  );
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
      return {
        close() {
          watcherClosed = true;
        },
      };
    },
    setTimer(callback, delayMs) {
      scheduledRefresh = { callback, delayMs };
      return 1;
    },
    clearTimer() {
      scheduledRefresh = null;
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: -1,
    totalSec: 8,
    audioActive: true,
  });
  await capture.waitForRefresh();
  assert.equal(typeof watchCallback, 'function');

  currentTime = 3000;
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: -1,
    totalSec: 8,
    audioActive: true,
  });
  const beforeRefreshMs = capture.getStatus().currentMs;

  const replacement = Buffer.from(
    encryptQrc(
      qrcXml('[ti:测试歌曲]\n[ar:测试歌手]\n[0,1200]新(0,600)词(600,600)', {
        saveTime: 8,
      }),
    ),
    'hex',
  );
  fs.writeFileSync(
    path.join(
      fixture.cachePath,
      'WeSingDL',
      'Res',
      fixture.mid,
      `${fixture.mid}.qrc`,
    ),
    replacement,
  );
  watchCallback(
    'change',
    path.join('WeSingDL', 'Res', fixture.mid, `${fixture.mid}.qrc`),
  );
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
    saveLyricOffsetMs(value) {
      savedOffsets.push(value);
    },
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: 4,
    totalSec: 8,
  });
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
