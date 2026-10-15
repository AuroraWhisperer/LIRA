'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildMusicRuntime } = require('../../src/server/music-runtime');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');
const INTERNAL_TIMELINE = { trackTitle: 'Internal', status: 'ready', lines: [{ startMs: 0, text: 'Internal line' }] };

async function fixture(t) {
  const parent = path.join(ROOT_DIR, 'tmp');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'lyric-source-handoff-'));
  const messages = [];
  let sample;
  const runtime = buildMusicRuntime({
    dataDir: { apiCacheDir: path.join(dir, 'api'), lyricCacheDir: path.join(dir, 'lyrics') },
    runtimeOptions: {
      weSingPlatform: 'win32',
      weSingMonitorFactory(callback) {
        sample = callback;
        return { start() {}, stop() {} };
      },
      weSingLyricResolver: async () => ({
        source: 'qq', artists: [], durationMs: 100000, lines: [{ startMs: 0, text: 'External line' }],
      }),
    },
    settingsStore: { getSettings: () => ({ weSingCachePath: path.join(dir, 'WeSingCache'), weSingLyricOffsetMs: '0' }) },
    webSocketHub: { broadcast: (message) => messages.push(message) },
  });
  t.after(() => {
    runtime.weSingCapture.stop();
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(parent));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function selectExternal() {
    await runtime.weSingCapture.setActive(true);
    sample({ detected: true, title: 'External', currentSec: 10, totalSec: 100, audioActive: true });
    await runtime.weSingCapture.refresh();
  }
  return { runtime, messages, selectExternal, stopExternal: () => sample({ detected: false }) };
}

test('selected WeSing owns lyrics even when delayed internal state has a newer generation', async (t) => {
  const { runtime, messages, selectExternal } = await fixture(t);
  runtime.publishLyricTimeline(INTERNAL_TIMELINE);
  runtime.publishLyricState({ trackTitle: 'Internal', status: 'ready', generation: 1, sequence: 1 });
  await selectExternal();
  const external = runtime.getLyricState();
  assert.equal(external.trackTitle, 'External');
  const count = messages.length;
  runtime.publishLyricState({ trackTitle: 'Internal', status: 'ready', generation: 20, sequence: 1 });
  assert.equal(runtime.getLyricState(), external);
  assert.equal(messages.length, count, 'rejected internal state must not be broadcast');
});

test('clock updates reuse the checked timeline, including after an equal replacement', async (t) => {
  const { runtime, messages } = await fixture(t);
  runtime.publishLyricTimeline(INTERNAL_TIMELINE);
  let reads = 0;
  const observeLines = timeline => {
    const lines = timeline.lines;
    Object.defineProperty(timeline, 'lines', { enumerable: true, get() { reads++; return lines; } });
  };
  observeLines(runtime.getLyricTimeline());
  const updateClock = () => {
    reads = 0;
    const offset = messages.length;
    for (let index = 1; index <= 10; index++) {
      runtime.publishLyricState({ trackTitle: 'Internal', status: 'ready', playing: true, currentMs: index * 100 });
    }
    assert.equal(reads, 0, 'clock-only updates must not traverse a previously checked timeline');
    const states = messages.slice(offset).filter(message => message.type === 'lyric-state').map(message => message.state);
    assert.equal(states.length, 10);
    assert.deepEqual(states.map(state => state.currentMs), Array.from({ length: 10 }, (_, i) => (i + 1) * 100));
    assert.ok(states.every((state, index) => index === 0 || state.sequence > states[index - 1].sequence));
    assert.equal(messages.slice(offset).filter(message => message.type === 'lyric-timeline').length, 0);
  };
  updateClock();
  const count = messages.filter(message => message.type === 'lyric-timeline').length;
  observeLines(runtime.publishLyricTimeline(structuredClone(INTERNAL_TIMELINE)));
  assert.equal(messages.filter(message => message.type === 'lyric-timeline').length, count);
  updateClock();
  runtime.publishLyricTimeline({ ...INTERNAL_TIMELINE, lines: [{ startMs: 10, text: 'Changed line' }] });
  assert.equal(messages.filter(message => message.type === 'lyric-timeline').length, count + 1);
  assert.equal(runtime.getLyricTimeline().lines[0].startMs, 10);
});

test('a source switch publishes even when both sources have equal timelines', async t => {
  const { runtime, messages, selectExternal } = await fixture(t);
  await selectExternal();
  const external = structuredClone(runtime.getLyricTimeline());
  runtime.publishLyricTimeline(external);
  runtime.publishLyricState({ trackTitle: external.trackTitle, status: 'ready', playing: true });
  const generation = runtime.getLyricState().generation;
  const offset = messages.length;
  await runtime.selectLyricSource('internal');
  assert.equal(runtime.getLyricSource().source, 'internal');
  assert.deepEqual(runtime.getLyricTimeline(), external);
  assert.equal(messages.slice(offset).filter(message => message.type === 'lyric-timeline').length, 1);
  assert.ok(runtime.getLyricState().generation > generation);
});

test('WeSing keeps output while playing and cached internal timeline returns when it stops', async (t) => {
  const { runtime, messages, selectExternal, stopExternal } = await fixture(t);
  await selectExternal();
  const external = runtime.getLyricTimeline();
  assert.equal(external.trackTitle, 'External');
  const count = messages.length;
  runtime.publishLyricTimeline(INTERNAL_TIMELINE);
  assert.equal(runtime.getLyricTimeline(), external);
  assert.equal(messages.length, count, 'rejected internal timeline must not be broadcast');
  await runtime.weSingCapture.setActive(false);
  assert.equal(runtime.getLyricSource().source, 'wesing', 'sole playing source remains visible without preference');
  stopExternal();
  runtime.publishLyricTimeline(INTERNAL_TIMELINE);
  runtime.publishLyricState({ trackTitle: 'Internal', status: 'ready' });
  assert.equal(runtime.getLyricTimeline().trackTitle, 'Internal');
  assert.equal(runtime.getLyricState().trackTitle, 'Internal');
});

for (const phase of ['timeline', 'state']) {
  test(`source handoff discards pending ${phase} work and republishes the same internal track on return`, async (t) => {
    const { runtime, selectExternal, stopExternal } = await fixture(t);
    const held = Promise.withResolvers();
    const requests = [];
    let stalled = false;
    const { LyricService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/services/lyric-service.js'), {
      fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, body });
        if (!stalled && url.endsWith(`/lyric-${phase}`)) {
          stalled = true;
          await held.promise;
        }
        const data = url.endsWith('/lyric-state') ? runtime.publishLyricState(body) : runtime.publishLyricTimeline(body);
        return { ok: true, json: async () => ({ ok: true, data }) };
      },
    });
    const service = new LyricService();
    const track = { id: 'internal', source: 'qq', title: 'Internal', lyrics: { lines: INTERNAL_TIMELINE.lines } };
    const audio = { currentTime: 10, duration: 100, paused: false };
    const first = service.syncWindow(track, audio, true);
    await new Promise(setImmediate);
    const pending = service.syncWindow(track, { ...audio, currentTime: 20 }, true);
    service.suspendWindow();
    await selectExternal();
    const count = requests.length;
    held.resolve();
    await Promise.all([first, pending]);
    assert.equal(runtime.getLyricTimeline().trackTitle, 'External');
    assert.equal(runtime.getLyricState().trackTitle, 'External');
    assert.equal(requests.length, count, 'suspended work must neither retry nor drain old queued publications');
    await runtime.weSingCapture.setActive(false);
    stopExternal();
    await service.syncWindow(track, { ...audio, currentTime: 20, paused: true }, true);
    assert.equal(runtime.getLyricTimeline().trackTitle, 'Internal', 'same-track cache must not retain the external timeline');
    assert.equal(runtime.getLyricState().trackTitle, 'Internal');
    assert.equal(runtime.getLyricState().currentMs, 20000);
    assert.equal(runtime.getLyricState().playing, false);
  });
}

test('lyric controls publish internal candidates independently of provider tabs and displayed source', async () => {
  const { createLyricControls } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/features/lyric-controls.js'));
  const playbackState = { selectedSource: 'wesing', current: { title: 'Internal' } };
  const publications = [];
  const controls = createLyricControls({
    playbackState,
    lyricService: { suspendWindow: () => assert.fail('output choice cannot suspend candidates'), syncWindow: (...args) => publications.push(args) },
    weSingService: { setSelected: () => assert.fail('publication must not change the source preference') },
  });
  const audio = { paused: true };
  for (const source of ['qq-client', 'netease-client', 'wesing', 'internal']) {
    playbackState.lyricSource = source;
    await controls.syncPlaybackLyricWindow(true, () => audio);
    assert.equal(publications.at(-1)[0], playbackState.current);
    assert.equal(publications.at(-1)[1], audio);
  }
  assert.equal(publications.length, 4);
});
