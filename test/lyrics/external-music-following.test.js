'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildMusicRuntime } = require('../../src/server/music-runtime');

async function fixture(t, extra = {}) {
  const samples = {};
  const starts = {};
  const stops = {};
  const messages = [];
  const monitor = (source) => (callback) => {
    samples[source] = callback;
    return { start: () => { starts[source] = (starts[source] || 0) + 1; },
      stop: () => { stops[source] = (stops[source] || 0) + 1; } };
  };
  const runtime = buildMusicRuntime({ dataDir: {}, settingsStore: { getSettings: () => ({}) },
    webSocketHub: { broadcast: (message) => messages.push(message) },
    runtimeOptions: { qqClientPlatform: 'win32', neteaseClientPlatform: 'win32', weSingPlatform: 'linux',
      qqClientMonitorFactory: monitor('qq'), neteaseClientMonitorFactory: monitor('netease'),
      qqClientLyricResolver: async () => ({ source: 'qq', lines: [{ startMs: 0, text: 'QQ line' }] }),
      neteaseClientLyricResolver: async () => ({ source: 'netease', lines: [{ startMs: 0, text: 'NetEase line' }] }), ...extra },
  });
  t.after(() => runtime.stop());
  await runtime.start();
  async function sample(source, playbackStatus = 'Playing') {
    const input = { detected: true, appId: source, title: source, artist: 'Artist', playbackStatus,
      positionMs: 10000, durationMs: 120000, timelineUpdatedAt: Date.now() };
    samples[source](input);
    samples[source](input);
    await new Promise(setImmediate);
  }
  return { runtime, samples, sample, starts, stops, messages };
}

test('sole playing external client follows without selection; choosing another does not disable it', async (t) => {
  const { runtime, sample, starts, stops } = await fixture(t);
  assert.equal(runtime.getLyricSource().selection, 'auto');
  await sample('netease');
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  assert.equal(runtime.getLyricTimeline().lines[0].text, 'NetEase line');
  await runtime.selectLyricSource('qq-client');
  assert.equal(runtime.getLyricSource().selection, 'qq-client');
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  assert.deepEqual(starts, { qq: 1, netease: 1 });
  assert.deepEqual(stops, {});
});

test('simultaneous players retain current in auto; preference and pause handoff replay matching timeline', async (t) => {
  const { runtime, sample } = await fixture(t);
  await sample('qq');
  await sample('netease');
  assert.equal(runtime.getLyricSource().source, 'qq-client');
  assert.deepEqual(runtime.getLyricSource().playingSources, ['qq-client', 'netease-client']);
  await runtime.selectLyricSource('netease-client');
  assert.equal(runtime.getLyricTimeline().lines[0].text, 'NetEase line');
  assert.equal(runtime.getLyricState().trackTitle, 'netease');
  await sample('netease', 'Paused');
  assert.equal(runtime.getLyricSource().source, 'qq-client');
  assert.equal(runtime.getLyricTimeline().lines[0].text, 'QQ line');
  await sample('qq', 'Stopped');
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  assert.equal(runtime.getLyricState().playing, false);
});

test('internal candidate continues updating behind external output and can be chosen while both play', async (t) => {
  const { runtime, sample } = await fixture(t);
  await sample('qq');
  const external = runtime.getLyricState();
  runtime.publishLyricTimeline({ trackTitle: 'Internal', status: 'ready', lines: [{ startMs: 0, text: 'Internal line' }] });
  runtime.publishLyricState({ trackTitle: 'Internal', playing: true, status: 'ready', currentMs: 20000, generation: 90, sequence: 1 });
  assert.equal(runtime.getLyricState(), external);
  await runtime.selectLyricSource('internal');
  assert.equal(runtime.getLyricState().trackTitle, 'Internal');
  assert.equal(runtime.getLyricState().currentMs, 20000);
  assert.equal(runtime.getLyricTimeline().lines[0].text, 'Internal line');
  await sample('qq');
  assert.equal(runtime.getLyricSource().source, 'internal', 'background QQ cannot overwrite preference');
});

test('handoff while an internal track state is pending cannot combine the new timeline with old lyrics', async (t) => {
  const { runtime, sample } = await fixture(t);
  runtime.publishLyricTimeline({ trackTitle: 'Internal A', status: 'ready', lines: [{ startMs: 0, text: 'A lyric' }] });
  runtime.publishLyricState({ trackTitle: 'Internal A', status: 'ready', playing: true, currentMs: 40000,
    lineText: 'A lyric', generation: 10, sequence: 1 });
  await sample('qq');
  await runtime.selectLyricSource('qq-client');
  runtime.publishLyricTimeline({ trackTitle: 'Internal B', status: 'ready', lines: [{ startMs: 0, text: 'B lyric' }] });
  await sample('qq', 'Paused');
  assert.equal(runtime.getLyricSource().source, 'internal');
  assert.equal(runtime.getLyricTimeline().trackTitle, 'Internal B');
  assert.equal(runtime.getLyricState().trackTitle, 'Internal B');
  assert.equal(runtime.getLyricState().lineText, '');
  assert.equal(runtime.getLyricState().currentMs, 0);
  assert.equal(runtime.getLyricState().playing, false);
  runtime.publishLyricState({ trackTitle: 'Internal B', status: 'ready', playing: true, currentMs: 1000,
    lineText: 'B lyric', generation: 20, sequence: 1 });
  assert.equal(runtime.getLyricState().lineText, 'B lyric');
  assert.equal(runtime.getLyricState().playing, true);
});

test('playing without lyrics stays its own source and late inactive results cannot overwrite another player', async (t) => {
  const pending = Promise.withResolvers();
  const { runtime, sample } = await fixture(t, { qqClientLyricResolver: () => pending.promise,
    neteaseClientLyricResolver: async () => null });
  await sample('qq');
  assert.equal(runtime.getLyricSource().source, 'qq-client');
  await sample('netease');
  await runtime.selectLyricSource('netease-client');
  assert.equal(runtime.getLyricSource().neteaseClient.status, 'empty');
  pending.resolve({ source: 'qq', lines: [{ startMs: 0, text: 'Late QQ' }] });
  await new Promise(setImmediate);
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  assert.equal(runtime.getLyricTimeline().status, 'empty');
  assert.deepEqual(runtime.getLyricTimeline().lines, []);
});

test('retries target one client; shutdown retires both monitors and their callbacks', async (t) => {
  const { runtime, samples, starts, stops, messages } = await fixture(t);
  await runtime.refreshLyricSource('netease-client');
  assert.deepEqual(starts, { qq: 1, netease: 2 });
  assert.deepEqual(stops, { netease: 1 });
  await runtime.start();
  assert.equal(starts.qq, 1);
  runtime.stop();
  const count = messages.length;
  samples.qq({ error: true }); samples.netease({ error: true });
  assert.equal(messages.length, count);
  assert.deepEqual(stops, { netease: 2, qq: 1 });
});
