'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { encryptQrc } = require('qrc-decoder');
const { buildPowerShellMonitorScript, createWeSingCapture } = require('../../src/music/wesing-capture');
const { createFixture, qrcXml } = require('../helpers/wesing-capture-fixture');
const { discoverWeSingCachePath, getWeSingCacheCandidates } = require('../../src/music/wesing-cache-discovery');

test('WeSing capture falls back to injected online lyrics when local QRC is absent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-online-'));
  const cachePath = path.join(root, 'WeSingCache');
  fs.mkdirSync(cachePath, { recursive: true });
  const logDir = path.join(cachePath, 'Log', 'WeSing');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'WeSing-online.log'),
    Buffer.from('event "StartKSong" payload {"mid":"online-mid","songname":"失控","artist":"井迪"}', 'utf16le'),
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
  assert.equal(state.cacheReady, true);
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
  fs.writeFileSync(path.join(fixture.cachePath, 'WeSingDL', 'Res', fixture.mid, `${fixture.mid}.qrc`), replacement);
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

test('WeSing repeatedly switches cached renditions with identical titles and ignores unrelated log writes', async (t) => {
  const fixture = createFixture();
  let onSample;
  let onWatch;
  let timerId = 0;
  const timers = new Map();
  const renditions = [
    { mid: 'en', title: '天若有情', artist: 'en', startMs: 1000 },
    { mid: 'alin', title: '天若有情', artist: 'A-Lin', startMs: 20000 },
    { mid: 'yu', title: '春泥', artist: '余超颖', startMs: 3000 },
    { mid: 'harlem', title: '春泥', artist: '庾澄庆', startMs: 15000 },
  ];
  for (const { mid, title, artist, startMs } of renditions) {
    const directory = path.join(fixture.cachePath, 'WeSingDL', 'Res', mid);
    fs.mkdirSync(directory, { recursive: true });
    const metadata = mid === 'alin' ? '[ti:12345]' : `[ti:${title}]\n[ar:${artist}]`;
    const content = `${metadata}\n[${startMs},30000]${artist}(${startMs},30000)`;
    fs.writeFileSync(path.join(directory, `${mid}.qrc`), Buffer.from(encryptQrc(qrcXml(content)), 'hex'));
  }
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    now: () => 0,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
    watchFactory(_directory, _options, callback) {
      onWatch = callback;
      return { close() {} };
    },
    setTimer(callback, delay) {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimer(id) { timers.delete(id); },
  });
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  await capture.setActive(true);
  async function notifyLog() {
    onWatch('change', 'Log\\WeSing\\WeSing-1.log');
    const [id, timer] = [...timers].find(([, value]) => value.delay === 100);
    timers.delete(id);
    timer.callback();
    await capture.waitForRefresh();
  }
  // QRC files are already downloaded; changing the rendition writes only the log.
  for (const index of [0, 1, 0, 1, 2, 3, 2, 3, 0, 2, 1, 3]) {
    const rendition = renditions[index];
    const { mid, title, artist, startMs } = rendition;
    const row = `\r\nevent "StartKSong" payload ${JSON.stringify({ mid, songname: title, artist })}\r\n`;
    fs.appendFileSync(path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-1.log'), Buffer.from(row, 'utf16le'));
    onSample({ detected: true, title, currentSec: 0, totalSec: 60 });
    await capture.waitForRefresh();
    await notifyLog();
    onSample({ detected: true, title, currentSec: 0, totalSec: 60 });
    let state = capture.getStatus();
    assert.equal(state.songMid, mid);
    assert.deepEqual(state.lyricState.artists, [artist]);
    assert.equal(state.lyricState.lineText, '', 'intro does not retain the previous rendition');
    const currentSec = startMs / 1000 + 1;
    onSample({ detected: true, title, currentSec, totalSec: 60 });
    state = capture.getStatus();
    assert.equal(state.lyricState.lineText, artist);
    assert.equal(state.currentMs, currentSec * 1000 + 130);
    fs.appendFileSync(path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-1.log'),
      Buffer.from('\r\nordinary log entry'.repeat(4000), 'utf16le'));
    await notifyLog();
    assert.deepEqual(capture.getStatus(), state, 'ordinary log writes do not reset the clock or refetch lyrics');
    await capture.refresh();
    assert.equal(capture.getStatus().songMid, mid, 'refresh after log growth must retain the current rendition');
    assert.equal(capture.getStatus().lyricState.lineText, artist);
  }
});

test('WeSing lyric offset is validated, persisted, and applied without changing raw progress', async (t) => {
  const fixture = createFixture();
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
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

test('WeSing automatically follows newly created and moved caches without refresh or file events', async (t) => {
  const fixture = createFixture();
  const appData = path.join(fixture.root, 'Users', '测试用户', 'AppData', 'Roaming');
  const [first] = getWeSingCacheCandidates({ APPDATA: appData });
  const second = path.join(fixture.root, 'E', 'WeSingCache');
  let timestamp = 0;
  let sample;
  let discoveries = 0;
  let timelines = 0;
  const saved = [];
  const capture = createWeSingCapture({
    cachePath: first, platform: 'win32', now: () => timestamp,
    monitorFactory(callback) { sample = callback; return { start() {}, stop() {} }; },
    watchFactory: () => ({ close() {} }),
    onTimeline: () => { timelines += 1; },
    discoverCachePath(input) {
      discoveries += 1;
      return discoverWeSingCachePath({ ...input, candidates: [first, second] });
    },
    saveCachePath: (value) => saved.push(value),
  });
  t.after(() => { capture.stop(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
  const sendSample = async (currentSec = 1) => {
    sample({ detected: true, title: '测试歌曲', currentSec, totalSec: 8 });
    await capture.waitForRefresh();
  };
  await capture.setActive(true);
  await sendSample();
  assert.equal(capture.getStatus().cacheReady, false);

  fs.cpSync(path.join(fixture.cachePath, 'Log'), path.join(first, 'Log'), { recursive: true });
  timestamp = 3001;
  await sendSample();
  assert.equal(capture.getStatus().cacheReady, true);
  assert.equal(capture.getStatus().qrcReady, false, 'the log can arrive before the lyrics download');
  fs.cpSync(path.join(fixture.cachePath, 'WeSingDL'), path.join(first, 'WeSingDL'), { recursive: true });
  timestamp = 6002;
  await sendSample();
  assert.equal(capture.getStatus().qrcReady, true, 'the first download is picked up automatically');
  assert.equal(capture.getStatus().songMid, fixture.mid);

  fs.cpSync(fixture.cachePath, second, { recursive: true });
  const writeRendition = (mid, lyric, modifiedSeconds) => {
    const directory = path.join(second, 'WeSingDL', 'Res', mid);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${mid}.qrc`), Buffer.from(encryptQrc(qrcXml(
      `[ti:测试歌曲]\n[ar:新歌手]\n[1000,6000]${lyric}(1000,6000)`,
    )), 'hex'));
    const log = path.join(second, 'Log', 'WeSing', 'WeSing-1.log');
    fs.appendFileSync(log, Buffer.from(`\r\nevent "StartKSong" payload ${JSON.stringify({ mid, songname: '测试歌曲' })}`, 'utf16le'));
    fs.utimesSync(log, modifiedSeconds, modifiedSeconds);
  };
  writeRendition('moved-cover', '新版本', Date.now() / 1000 + 10);
  timestamp = 9003;
  await sendSample(3);
  assert.equal(capture.getStatus().cachePath, second, 'an existing old directory does not pin capture there');
  assert.equal(capture.getStatus().songMid, 'moved-cover');
  assert.equal(capture.getStatus().currentMs, 3130);
  assert.deepEqual(saved, [second]);

  writeRendition('next-cover', '再切版本', Date.now() / 1000 + 20);
  timestamp = 12004;
  await sendSample(0);
  await sendSample(1);
  assert.equal(capture.getStatus().songMid, 'next-cover', 'periodic identity checks recover missed file events');
  assert.equal(capture.getStatus().lyricState.lineText, '再切版本');
  const before = { discoveries, timelines };
  timestamp = 12005;
  await sendSample(2);
  assert.equal(discoveries, before.discoveries, 'monitor samples are throttled');
  timestamp = 15005;
  await sendSample(3);
  assert.equal(timelines, before.timelines, 'an unchanged cache does not reload lyrics');
  assert.equal(capture.getStatus().currentMs, 3130);
  assert.deepEqual(saved, [second], 'an unchanged path is not saved again');
});
