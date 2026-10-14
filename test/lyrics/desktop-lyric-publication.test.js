'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('official trial playback publishes song-relative lyric time and returns to zero offset for full audio', async () => {
  const requests = [];
  const { LyricService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/services/lyric-service.js'),
    { fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true }; } },
  );
  const service = new LyricService();
  const words = [{ startMs: 30000, endMs: 34000, text: '试听歌词' }];
  const track = { id: 'netease:123', source: 'netease', playbackTrial: true, playbackTrialStartMs: 30000,
    lyrics: { lines: [{ startMs: 0, text: '开头' }, { startMs: 30000, text: '试听歌词', words }] } };
  const audio = { currentTime: 2.345, duration: 30, paused: false };
  await service.syncWindow(track, audio, true);
  let state = requests.at(-1).body;
  assert.equal(state.lineText, '试听歌词');
  assert.equal(state.currentMs, 32345);
  assert.equal(state.durationMs, 60000);
  assert.deepEqual(state.words, words);
  audio.currentTime = 1.25;
  audio.paused = true;
  await service.syncWindow(track, audio, true);
  assert.equal(requests.at(-1).body.currentMs, 31250);
  assert.equal(requests.at(-1).body.playing, false);
  track.playbackTrial = false;
  audio.duration = 180;
  await service.syncWindow(track, audio, true);
  state = requests.at(-1).body;
  assert.equal(state.currentMs, 1250);
  assert.equal(state.durationMs, 180000);
  assert.equal(state.lineText, '开头');
});

test('playback publishes a complete timeline only when the lyric identity changes', async () => {
  const requests = [];
  const playback = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    {
      fetch: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return { ok: true };
      },
    },
  );
  const service = new playback.LyricService();
  const track = {
    id: 'qq:timeline-song',
    source: 'qq',
    title: 'Timeline Song',
    artists: ['Timeline Artist'],
    lyrics: { lines: [{ startMs: 0, text: '制作：Timeline Studio' }] },
  };
  const audio = { currentTime: 1, duration: 120, paused: false };

  await service.syncWindow(track, audio);
  await service.syncWindow(track, audio);
  track.lyrics = { lines: [{ startMs: 0, text: '制作：Timeline Studio' }] };
  await service.syncWindow(track, audio);

  const timelineRequests = requests.filter((request) => request.url === '/api/playback/lyric-timeline');
  assert.equal(timelineRequests.length, 2);
  assert.equal(timelineRequests[0].body.lines[0].text, '制作：Timeline Studio');
});

test('timeline publication cannot let an older track finish after a newer one', async () => {
  const timelines = [];
  const states = [];
  const pending = [];
  const { LyricService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/services/lyric-service.js'),
    {
      fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        if (url.endsWith('/lyric-timeline')) {
          timelines.push(body.trackTitle);
          return new Promise((resolve) => pending.push(resolve));
        }
        states.push(body.trackTitle);
        return { ok: true, json: async () => ({ ok: true, data: body }) };
      },
    },
  );
  const service = new LyricService();
  const track = (id) => ({ id, source: 'qq', title: id, lyrics: { lines: [{ startMs: 0, text: id }] } });
  const audio = { currentTime: 1, duration: 120, paused: false };
  const first = service.syncWindow(track('older'), audio, true);
  const skipped = service.syncWindow(track('superseded'), audio, true);
  const last = service.syncWindow(track('current'), audio, true);
  await new Promise(setImmediate);
  assert.deepEqual(timelines, ['older'], 'only one timeline request may be in flight');
  pending.shift()({ ok: true });
  await new Promise(setImmediate);
  assert.deepEqual(timelines, ['older', 'current'], 'queued track switches retain only the newest timeline');
  pending.shift()({ ok: true });
  await Promise.all([first, skipped, last]);
  assert.deepEqual(states, ['current']);
});

for (const failure of ['network', 'http']) {
  test(`timeline publication retries the same track after a ${failure} failure`, async () => {
    let attempts = 0;
    const { LyricService } = await loadModuleExports(
      path.join(ROOT_DIR, 'public/js/playback/services/lyric-service.js'),
      {
        fetch: async (url, options) => {
          if (url.endsWith('/lyric-timeline')) {
            if (++attempts === 1) {
              if (failure === 'network') throw new Error('offline');
              return { ok: false };
            }
            return { ok: true };
          }
          return { ok: true, json: async () => ({ ok: true, data: JSON.parse(options.body) }) };
        },
      },
    );
    const service = new LyricService();
    const track = { id: 'recover', source: 'qq', lyrics: { lines: [{ startMs: 0, text: 'line' }] } };
    const audio = { currentTime: 1, duration: 120, paused: false };
    await service.syncWindow(track, audio, true);
    await service.syncWindow(track, audio, true);
    assert.equal(attempts, 2);
  });
}

test('forced playback states bypass throttling and preserve publication order', async () => {
  const stateRequests = [];
  let releaseFirstState;
  const playback = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    {
      fetch: async (url, options) => {
        if (url === '/api/playback/lyric-timeline') return { ok: true };
        stateRequests.push(JSON.parse(options.body));
        if (stateRequests.length === 1) {
          return new Promise((resolve) => {
            releaseFirstState = () => resolve({ ok: true });
          });
        }
        return { ok: true };
      },
    },
  );
  const service = new playback.LyricService();
  const track = {
    id: 'qq:controlled-song',
    source: 'qq',
    title: 'Controlled Song',
    artists: ['Controlled Artist'],
    lyrics: {
      lines: [
        { startMs: 0, text: '第一句' },
        { startMs: 42000, text: '跳转后' },
      ],
    },
  };
  const audio = { currentTime: 1, duration: 120, paused: false };

  const playingPublish = service.syncWindow(track, audio, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stateRequests.length, 1);

  audio.currentTime = 42;
  audio.paused = true;
  const seekAndPausePublish = service.syncWindow(track, audio, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stateRequests.length, 1, 'newer state waits until the prior request finishes');

  releaseFirstState();
  await Promise.all([playingPublish, seekAndPausePublish]);
  assert.equal(stateRequests.length, 2);
  assert.equal(stateRequests[0].playing, true);
  assert.equal(stateRequests[0].currentMs, 1000);
  assert.equal(stateRequests[1].playing, false);
  assert.equal(stateRequests[1].currentMs, 42000);
  assert.equal(stateRequests[1].lineText, '跳转后');
});

test('ordinary lyric publication is latest-wins while one request is in flight', async () => {
  const requests = [];
  let releaseFirst;
  const playback = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    {
      fetch: async (url, options) => {
        if (url === '/api/playback/lyric-timeline') return { ok: true };
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ ok: true });
          });
        }
        return { ok: true };
      },
    },
  );
  const service = new playback.LyricService();
  const track = {
    id: 'latest-wins',
    source: 'qq',
    title: 'Latest',
    artists: [],
    lyrics: { lines: [{ startMs: 0, text: 'line' }] },
  };
  const audio = { currentTime: 1, duration: 120, paused: false };
  const first = service.syncWindow(track, audio);
  audio.currentTime = 2;
  const second = service.syncWindow(track, audio);
  audio.currentTime = 3;
  const third = service.syncWindow(track, audio);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  releaseFirst();
  await Promise.all([first, second, third]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].currentMs, 3000);
  assert.ok(requests[1].sequence > requests[0].sequence);
  assert.equal(requests[1].durationMs, 120000);
  assert.equal(requests[1].status, 'ready');

  await service.syncWindow(null, audio, true);
  assert.equal(requests.at(-1).status, 'idle');
  assert.equal(requests.at(-1).trackTitle, '');
});

test('lyric scheduler gates animation frames to its target rate and stops when hidden', async () => {
  const frames = [];
  const cancelled = [];
  const document = { visibilityState: 'visible' };
  const { LyricFrameScheduler } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-frame-scheduler.js'),
    {
      document,
      requestAnimationFrame: (callback) => frames.push(callback),
      cancelAnimationFrame: (id) => cancelled.push(id),
      setInterval: () => assert.fail('the scheduler must not use timers'),
    },
  );
  const ticks = [];
  const scheduler = new LyricFrameScheduler({ targetFps: 20 });
  scheduler.start((now, elapsed) => ticks.push([now, elapsed]));
  for (const now of [1000, 1016, 1049, 1050, 1090]) frames.at(-1)(now);
  assert.deepEqual(ticks, [
    [1000, 50],
    [1050, 50],
  ]);
  scheduler.setTargetFps(10);
  frames.at(-1)(1140);
  frames.at(-1)(1150);
  assert.deepEqual(ticks.at(-1), [1150, 100]);
  const requested = frames.length;
  document.visibilityState = 'hidden';
  frames.at(-1)(1300);
  assert.equal(frames.length, requested, 'a hidden document must not schedule more frames');
  assert.equal(scheduler.running, false);
});

test('30fps lyric scheduling accepts rounded timestamps without promoting fast or slow frames', async () => {
  const { LyricFrameScheduler } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-frame-scheduler.js'),
    { requestAnimationFrame: () => 1, cancelAnimationFrame() {} },
  );
  const ticks = [];
  const scheduler = new LyricFrameScheduler();
  scheduler.start((now, elapsed) => ticks.push([now, elapsed]));
  for (let index = 0; index < 120; index += 1) {
    scheduler.onFrame(Math.round((1000 + index * 1000 / 60) * 10) / 10);
  }
  assert.equal(ticks.length, 60, 'rounded 60Hz timestamps still deliver 30fps callbacks');
  assert.ok(ticks.every(([, elapsed]) => elapsed > 33 && elapsed < 34));
  const lastAt = ticks.at(-1)[0];
  scheduler.onFrame(lastAt + 16.7);
  assert.equal(ticks.length, 60, 'the comparison tolerance does not admit the next fast frame');
  scheduler.onFrame(lastAt + 60);
  assert.deepEqual(ticks.at(-1), [lastAt + 60, 60], 'a real long frame remains a real long sample');
  scheduler.stop();
});

test('shared lyric renderer freezes its clock when playback pauses', async () => {
  let currentTime = 1000;
  let nextFrameId = 0;
  const scheduledFrames = new Map();
  const canceledFrames = new Set();
  const lineElement = {
    textContent: '',
    replaceChildren() {},
    appendChild() {},
  };
  const progressElement = { style: { transform: '' } };
  const rendererModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'),
    {
      document: {
        createElement() {
          return {
            className: '',
            textContent: '',
            style: { setProperty() {} },
          };
        },
      },
      performance: { now: () => currentTime },
      requestAnimationFrame(callback) {
        nextFrameId += 1;
        scheduledFrames.set(nextFrameId, callback);
        return nextFrameId;
      },
      cancelAnimationFrame(frameId) {
        canceledFrames.add(frameId);
      },
    },
  );
  const renderer = new rendererModule.LyricWordRenderer({
    lineElement,
    progressElement,
  });

  renderer.setState({
    currentMs: 1000,
    durationMs: 10000,
    playing: true,
    lineText: '播放中',
  });
  const playingFrameId = nextFrameId;
  currentTime = 1500;
  scheduledFrames.get(playingFrameId)(currentTime);
  const pendingFrameId = nextFrameId;
  assert.equal(renderer.getPosition(currentTime).currentMs, 1500);

  renderer.setState({
    currentMs: 1200,
    durationMs: 10000,
    playing: false,
    lineText: '已暂停',
  });
  assert.equal(canceledFrames.has(pendingFrameId), true);
  assert.equal(nextFrameId, pendingFrameId, 'paused rendering does not schedule another animation frame');
  assert.equal(renderer.getPosition(5000).currentMs, 1200);
});

test('shared lyric renderer ignores ordinary jitter but applies explicit small seeks', async () => {
  let currentTime = 1000;
  const rendererModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'),
    {
      document: {
        createElement() {
          return {};
        },
      },
      performance: { now: () => currentTime },
      requestAnimationFrame() {
        return 0;
      },
      cancelAnimationFrame() {},
    },
  );
  const renderer = new rendererModule.LyricWordRenderer();

  renderer.setState({ currentMs: 1000, durationMs: 10000, playing: true, generation: 1 });
  currentTime = 1300;
  assert.equal(renderer.getPosition(currentTime).currentMs, 1300);

  renderer.setState({ currentMs: 1100, durationMs: 10000, playing: true });
  assert.equal(renderer.getPosition(currentTime).currentMs, 1300, 'ordinary sampling must not rewind playback');

  renderer.setState({ currentMs: 1100, generation: 2 });
  assert.equal(renderer.getPosition(currentTime).currentMs, 1100);

  currentTime = 1500;
  renderer.setState({ currentMs: 1200, generation: 2 });
  assert.equal(renderer.getPosition(currentTime).currentMs, 1300, 'the seek must not force later ordinary samples');
  renderer.setState({ currentMs: 1250, discontinuity: true });
  assert.equal(renderer.getPosition(currentTime).currentMs, 1250);
  currentTime = 1600;
  renderer.setState({ currentMs: 1300 });
  assert.equal(renderer.getPosition(currentTime).currentMs, 1350, 'explicit discontinuities apply only once');
  renderer.setState({ currentMs: 9000 });
  assert.equal(renderer.getPosition(currentTime).currentMs, 9000, 'large external seeks still correct immediately');
  renderer.dispose();

  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'lyric-window.js'), 'utf8');
  assert.doesNotMatch(overlaySource, /Math\.max\(incoming, estimated\)/);
});

test('lyric clock anchors pause and resume without advancing while paused', async () => {
  let now = 1000;
  const { LyricClock } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/lyric-clock.js'));
  const clock = new LyricClock({ now: () => now });
  clock.setState({ currentMs: 1000, durationMs: 10000, playing: true });
  now = 1500;
  clock.setState({ currentMs: 1400, playing: false });
  now = 2500;
  assert.equal(clock.getPosition().currentMs, 1400);
  clock.setState({ currentMs: 1500, playing: true });
  assert.equal(clock.getPosition().currentMs, 1500, 'resume uses the newly measured position');
  now = 2700;
  assert.equal(clock.getPosition().currentMs, 1700);
  clock.dispose();
});

test('shared lyric renderer keeps external sampling corrections from reversing lyric lines', async () => {
  let now = 0;
  const { LyricWordRenderer } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/lyric-word-renderer.js'), {
    performance: { now: () => now },
  });
  const { findActiveLyricIndex } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/lyrics/desktop-lyric-timeline.js'));
  const renderer = new LyricWordRenderer({ scheduler: { start() {}, stop() {} } });
  const lines = [{ startMs: 0 }, { startMs: 16050 }, { startMs: 17150 }];
  renderer.setState({ currentMs: 15000, playing: true, durationMs: 180000, generation: 1 });
  for (const currentMs of [15550, 16000, 16550, 17000]) {
    now += 550;
    const before = renderer.getPosition(now).currentMs;
    renderer.setState({ currentMs });
    const after = renderer.getPosition(now).currentMs;
    assert.ok(after >= before, `normal sampling must not move ${before} back to ${after}`);
    assert.ok(findActiveLyricIndex(lines, after) >= findActiveLyricIndex(lines, before));
  }
  renderer.setState({ currentMs: 17000, generation: 2, trackTitle: 'Other source' });
  assert.equal(renderer.getPosition(now).currentMs, 17000, 'a source/track change still anchors within the tolerance');
  renderer.dispose();
});

test('internal lyric publication preserves millisecond timing and does not jitter during playback', async () => {
  let now = 100000;
  const { LyricWordRenderer } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/lyric-word-renderer.js'), {
    performance: { now: () => now },
  });
  const renderer = new LyricWordRenderer({ scheduler: { start() {}, stop() {} } });
  const positions = [];
  const corrections = [];
  const { LyricService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/services/lyric-service.js'), {
    Date: class extends Date { static now() { return now; } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith('/lyric-state')) {
        const before = renderer.getPosition(now).currentMs;
        renderer.setState(body);
        positions.push(body.currentMs);
        corrections.push(renderer.getPosition(now).currentMs - before);
      }
      return { ok: true, json: async () => ({ ok: true, data: body }) };
    },
  });
  const service = new LyricService();
  const track = { id: 'steady', source: 'qq', title: 'Steady', lyrics: { lines: [{ startMs: 0, text: 'line' }] } };
  for (let step = 0; step < 7; step++) {
    now = 100000 + step * 250;
    await service.syncWindow(track, { currentTime: (10040 + step * 250) / 1000, duration: 180, paused: false });
  }
  assert.deepEqual(positions, [10040, 10290, 10540, 10790, 11040, 11290, 11540]);
  assert.ok(corrections.every((correction) => correction >= 0), 'continuous audio cannot rewind the display');
  renderer.dispose();
});

test('built-in playback forces lyric sync for play, pause, and seek transitions', () => {
  const initializer = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'core', 'initializer.js'),
    'utf8',
  );
  const handlers = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'core', 'event-handlers.js'),
    'utf8',
  );

  assert.match(initializer, /addEventListener\(["']play["'], \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/);
  assert.match(
    initializer,
    /addEventListener\(["']pause["'], \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/,
  );
  assert.match(
    initializer,
    /addEventListener\(["']seeking["'], \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/,
  );
  assert.match(
    initializer,
    /addEventListener\(["']seeked["'], \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/,
  );
  assert.match(handlers, /getElementById\(["']playbackSeek["']\)[\s\S]*?syncPlaybackLyricWindow\(true\)/);
});
