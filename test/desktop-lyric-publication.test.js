'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeLyricState } = require('../src/music/lyric-state');
const { normalizeLyricTimeline } = require('../src/music/lyric-timeline');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '..');

test('playback publishes lyrics through the authenticated local API', () => {
  const service = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    'utf8',
  );
  const routes = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'routes', 'playback-routes.js'), 'utf8');

  assert.match(service, /fetch\(["']\/api\/playback\/lyric-state["']/);
  assert.match(service, /fetch\(["']\/api\/playback\/lyric-timeline["']/);
  assert.match(service, /status:\s*!track\s*\?\s*["']idle["']/);
  assert.match(service, /durationMs:\s*Math\.round\(duration \* 1000\)/);
  assert.match(routes, /["']POST \/api\/playback\/lyric-state["']/);
  assert.match(routes, /["']POST \/api\/playback\/lyric-timeline["']/);
  assert.match(routes, /normalizeLyricState/);
  assert.match(routes, /normalizeLyricTimeline/);
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

test('lyric states carry monotonic generation and sequence discontinuity markers', () => {
  const first = normalizeLyricState({
    lineText: 'first',
    generation: 3,
    sequence: 7,
  });
  const legacy = normalizeLyricState({ lineText: 'legacy' });
  assert.equal(first.generation, 3);
  assert.equal(first.sequence, 7);
  assert.equal(legacy.generation, 0);
  assert.equal(legacy.sequence, 0);
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
});

test('lyric scheduler uses rAF time gating and performance profile degrades with hysteresis', async () => {
  const schedulerSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-frame-scheduler.js'),
    'utf8',
  );
  assert.match(schedulerSource, /requestAnimationFrame/);
  assert.match(schedulerSource, /1000 \/ this\.targetFps/);
  assert.doesNotMatch(schedulerSource, /setInterval/);

  const performanceModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-performance.js'),
    { window: { matchMedia: () => ({ matches: false }) } },
  );
  const profile = performanceModule.createLyricPerformanceProfile({});
  for (let index = 0; index < 4; index += 1) profile.recordFrame(60);
  assert.equal(profile.profile.targetFps, 30);
  assert.equal(profile.profile.wordAnimation, 'manual');
  profile.setVisible(false);
  assert.equal(profile.profile.targetFps, 30);
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

test('shared lyric renderer accepts small backward authoritative corrections', async () => {
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

  renderer.setState({ currentMs: 1000, durationMs: 10000, playing: true });
  currentTime = 1300;
  assert.equal(renderer.getPosition(currentTime).currentMs, 1300);

  renderer.setState({ currentMs: 1100, durationMs: 10000, playing: true });
  assert.equal(renderer.getPosition(currentTime).currentMs, 1100);

  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'lyric-window.js'), 'utf8');
  assert.doesNotMatch(overlaySource, /Math\.max\(incoming, estimated\)/);
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
