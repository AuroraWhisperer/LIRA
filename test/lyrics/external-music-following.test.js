'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildMusicRuntime } = require('../../src/server/music-runtime');
const { routes } = require('../../src/server/routes/playback-routes');
const { createExternalClientLyricResolver } = require('../../src/music/external-client-lyrics');

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

async function smtcFixture(t, platform, resolveLyrics) {
  let time = 100000;
  t.mock.method(Date, 'now', () => time);
  const { runtime, samples } = await fixture(t, resolveLyrics ? { [`${platform}ClientLyricResolver`]: resolveLyrics } : {});
  return {
    runtime,
    async send(at, changes = {}) {
      time = at;
      samples[platform]({ detected: true, appId: platform, title: 'Song', artist: 'Artist', clockSource: 'smtc',
        playbackStatus: 'Playing', positionMs: 0, durationMs: 180000, timelineUpdatedAt: 100000, ...changes });
      await new Promise(setImmediate);
    },
  };
}

for (const platform of ['qq', 'netease']) {
  test(`${platform} rematches a different recording of the same title and artist`, async (t) => {
    const fetched = [];
    const resolver = createExternalClientLyricResolver({ platform, getRegistry: () => ({}),
      catalogService: { async searchMusicTracks() {
        return { tracks: [180000, 240000].map((durationMs, i) => ({
          source: platform, sourceTrackId: String(101 + i), title: 'Song', artists: ['Artist'], durationMs,
        })) };
      } },
      lyricsService: { async getMusicTrackLyrics(_registry, { track }) {
        fetched.push(track.sourceTrackId);
        return { source: platform, lines: [{ startMs: 0, text: `歌词 ${track.sourceTrackId}` }] };
      } },
    });
    const { runtime, send } = await smtcFixture(t, platform, resolver);
    await send(100000);
    await send(100500);
    await send(101000, { durationMs: 185000 });
    assert.equal(runtime.getLyricState().lineText, '歌词 101');
    const next = { durationMs: 240000, timelineUpdatedAt: 101500 };
    await send(101500, next);
    await send(102000, next);
    assert.equal(runtime.getLyricState().lineText, '歌词 102');
    assert.deepEqual(fetched, ['101', '102']);
  });

  test(`${platform} recovers the current lyrics after a late sample reports a different duration`, async (t) => {
    const durations = [];
    const { runtime, send } = await smtcFixture(t, platform, async ({ durationMs }) => {
      durations.push(durationMs);
      return { source: platform, lines: [{ startMs: 0, text: 'Current' }] };
    });
    await send(100000);
    await send(100500);
    await send(101000, { durationMs: 241000, timelineUpdatedAt: 98000 });
    assert.equal(runtime.getLyricSource()[`${platform}Client`].status, 'loading');
    await send(101500);
    assert.equal(runtime.getLyricState().lineText, 'Current');
    assert.deepEqual(durations, [180000]);
  });

  test(`${platform} holds and resumes a stale SMTC anchor until a seek supplies a new position`, async (t) => {
    const { runtime, send } = await smtcFixture(t, platform);
    await send(100000);
    await send(110000);
    await send(110500, { playbackStatus: 'Paused' });
    assert.equal(runtime.getLyricState().currentMs, 10500);
    await send(140000, { playbackStatus: 'Paused' });
    assert.equal(runtime.getLyricState().currentMs, 10500);
    await send(140500);
    assert.equal(runtime.getLyricState().currentMs, 10500);
    await send(141000);
    assert.equal(runtime.getLyricState().currentMs, 11000);
    await send(141250, { positionMs: 10500, timelineUpdatedAt: 110500 });
    assert.equal(runtime.getLyricState().currentMs, 11250, 'a late pause reading cannot replay the pause interval');
    await send(141500, { positionMs: 2000, timelineUpdatedAt: 141500 });
    assert.equal(runtime.getLyricState().currentMs, 2000);
  });

  test(`${platform} integrates half-speed, pause and resume at the observed transitions`, async (t) => {
    const { runtime, send } = await smtcFixture(t, platform);
    await send(100000);
    await send(102000);
    const slow = { playbackRate: 0.5 };
    await send(103000, slow);
    assert.equal(runtime.getLyricState().playbackRate, 0.5);
    const paused = { ...slow, playbackStatus: 'Paused' };
    await send(107000, paused);
    assert.equal(runtime.getLyricState().currentMs, 5000);
    await send(137000, paused);
    assert.equal(runtime.getLyricState().currentMs, 5000);
    await send(137500, { ...slow, positionMs: 5000, timelineUpdatedAt: 107000 });
    assert.equal(runtime.getLyricState().currentMs, 5000);
    await send(138000, { ...slow, positionMs: 5000, timelineUpdatedAt: 107000 });
    assert.equal(runtime.getLyricState().currentMs, 5250);
  });

  test(`${platform} applies a paused seek stamped before the pause was observed`, async (t) => {
    const { runtime, send } = await smtcFixture(t, platform);
    await send(100000);
    await send(102000);
    await send(103000, { playbackStatus: 'Paused' });
    const seek = { positionMs: 50700, timelineUpdatedAt: 102800 };
    await send(103500, { ...seek, playbackStatus: 'Paused' });
    assert.equal(runtime.getLyricState().currentMs, 50700);
    await send(108000, seek);
    await send(108500, seek);
    assert.equal(runtime.getLyricState().currentMs, 51200);
    await send(109000, { playbackStatus: 'Paused', positionMs: 900, timelineUpdatedAt: 108200 });
    assert.equal(runtime.getLyricState().currentMs, 900);
  });

  test(`${platform} waits for a new clock through two same-title switches and ignores late lyrics`, async (t) => {
    const requests = [];
    const { runtime, send } = await smtcFixture(t, platform, (track) => {
      const request = Promise.withResolvers();
      requests.push({ ...request, track });
      return request.promise;
    });
    // For QQ the duration identifies each recording. For NetEase only its ID changes.
    const version = (index) => platform === 'qq' ? { durationMs: 180000 + 60000 * index } : { sourceTrackId: String(101 + index) };
    let clock = { timelineUpdatedAt: 100000, positionMs: 40000 };
    await send(100000, { ...version(0), ...clock });
    await send(100500, { ...version(0), ...clock });
    for (let index = 1; index <= 2; index++) {
      const at = 100000 + index * 10000;
      const recording = version(index);
      await send(at, { ...recording, ...clock });
      await send(at + 500, { ...recording, ...clock });
      assert.equal(requests.length, index, 'metadata alone must not pair the new recording with the old clock');
      assert.equal(runtime.getLyricSource()[`${platform}Client`].status, 'loading');
      clock = { timelineUpdatedAt: at + 1000, positionMs: 0 };
      await send(at + 1000, { ...recording, ...clock });
      assert.equal(requests.length, index + 1);
    }
    for (const index of [2, 1, 0]) {
      const expected = version(index);
      for (const [key, value] of Object.entries(expected)) assert.equal(requests[index].track[key], value);
      requests[index].resolve({ source: platform, coverUrl: `https://example.test/${index}.jpg`,
        lines: [{ startMs: 0, text: `版本 ${index}` }] });
      await new Promise(setImmediate);
    }
    assert.equal(runtime.getLyricState().lineText, '版本 2');
    assert.equal(runtime.getLyricState().currentMs, 0);
    assert.equal(runtime.getLyricTimeline().lines[0].text, '版本 2');
    assert.equal(runtime.getNowPlayingState().coverUrl, 'https://example.test/2.jpg');
  });

  test(`${platform} accepts a new song's only zero anchor after the old zero has advanced`, async (t) => {
    const { runtime, send } = await smtcFixture(t, platform, async ({ title }) => ({
      source: platform, lines: [{ startMs: 0, text: title }],
    }));
    await send(100000);
    await send(110000);
    assert.equal(runtime.getLyricState().currentMs, 10000);
    const next = { title: 'Next', timelineUpdatedAt: 110500 };
    await send(110500, next);
    await send(111000, next);
    assert.equal(runtime.getLyricState().lineText, 'Next');
    assert.equal(runtime.getLyricState().currentMs, 500);
  });

  test(`${platform} waits when the handoff reading advances more slowly than the old clock`, async (t) => {
    const titles = [];
    const { runtime, send } = await smtcFixture(t, platform, async ({ title }) => {
      titles.push(title);
      return { source: platform, lines: [{ startMs: 0, text: title }] };
    });
    await send(100000, { positionMs: 40000 });
    await send(104000, { positionMs: 40000 });
    const handoff = { title: 'Next', positionMs: 48800, timelineUpdatedAt: 110000 };
    await send(110000, handoff);
    await send(110500, handoff);
    assert.equal(runtime.getLyricSource()[`${platform}Client`].status, 'loading');
    assert.deepEqual(titles, ['Song']);
    await send(111000, { title: 'Next', positionMs: 300, timelineUpdatedAt: 111000 });
    assert.equal(runtime.getLyricState().lineText, 'Next');
    assert.equal(runtime.getLyricState().currentMs, 300);
  });
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

test('external clock ticks and seeks update lyrics without republishing source controls', async (t) => {
  let time = 100000;
  t.mock.method(Date, 'now', () => time);
  const { runtime, sample, samples, messages } = await fixture(t);
  samples.netease({ detected: false });
  messages.length = 0;
  samples.netease({ detected: false });
  assert.equal(messages.length, 0);
  await sample('netease');
  messages.length = 0;
  const tick = (positionMs, playbackStatus) => {
    time += 500;
    samples.netease({ detected: true, appId: 'netease', title: 'netease', artist: 'Artist',
      playbackStatus, positionMs, durationMs: 120000, timelineUpdatedAt: time });
  };
  for (const ms of [10500, 11000, 2000]) tick(ms, 'Playing');
  assert.deepEqual(messages.filter(m => m.type === 'lyric-state').map(m => m.state.currentMs), [10500, 11000, 2000]);
  assert.equal(messages.filter(m => m.type === 'lyric-source').length, 0);
  assert.equal(runtime.getLyricSource().neteaseClient.currentMs, 2000);
  tick(2500, 'Paused');
  const change = messages.filter(m => m.type === 'lyric-source');
  assert.equal(change.length, 1);
  assert.equal(change[0].state.neteaseClient.currentMs, 2500);
  assert.equal(change[0].state.neteaseClient.playing, false);
  assert.equal(typeof change[0].state.weSing.lyricState.currentMs, 'number');
});

test('playing native NetEase replaces a paused internal track in auto and explicit preference', async (t) => {
  const { runtime, samples } = await fixture(t);
  runtime.publishLyricTimeline({ trackTitle: 'Internal', status: 'ready', lines: [{ startMs: 0, text: 'Internal line' }] });
  runtime.publishLyricState({ trackTitle: 'Internal', playing: false, status: 'ready', currentMs: 20000 });
  samples.netease({ detected: true, title: 'External', artists: ['Artist'], playbackStatus: 'Unknown', clockSource: 'uia' });
  assert.equal(runtime.getLyricSource().source, 'internal');
  const input = { detected: true, title: 'External', artists: ['Artist'], sourceTrackId: '123', clockSource: 'native',
    playbackStatus: 'Playing', positionMs: 104123, durationMs: 200008, timelineUpdatedAt: Date.now() };
  samples.netease(input);
  await new Promise(setImmediate);
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  assert.equal(runtime.getLyricTimeline().lines[0].text, 'NetEase line');
  assert.equal(runtime.getLyricState().trackTitle, 'External');
  assert.equal(runtime.getLyricState().playing, true);
  await runtime.selectLyricSource('netease-client');
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  samples.netease({ ...input, playbackStatus: 'Paused', timelineUpdatedAt: Date.now() });
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  assert.equal(runtime.getLyricState().playing, false);
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
  assert.equal(runtime.getNowPlayingState().source, 'netease-client');
  assert.equal(runtime.getNowPlayingState().trackTitle, 'netease');
  assert.equal(runtime.getNowPlayingState().playing, true);
  assert.deepEqual(runtime.getNowPlayingState().artists, ['Artist']);
  pending.resolve({ source: 'qq', coverUrl: 'https://example.test/qq.jpg', lines: [{ startMs: 0, text: 'Late QQ' }] });
  await new Promise(setImmediate);
  assert.equal(runtime.getLyricSource().source, 'netease-client');
  assert.equal(runtime.getLyricTimeline().status, 'empty');
  assert.deepEqual(runtime.getLyricTimeline().lines, []);
  assert.equal(runtime.getNowPlayingState().coverUrl, '', 'inactive results cannot replace the selected artwork');
  await sample('netease', 'Paused');
  await sample('qq', 'Stopped');
  assert.equal(runtime.getNowPlayingState().playing, false);
});

test('internal lyric HTTP publications preserve artwork without extending lyric responses', async (t) => {
  const { runtime } = await fixture(t);
  const context = { playbackLyrics: { publish: runtime.publishLyricState, publishTimeline: runtime.publishLyricTimeline } };
  for (const kind of ['lyric-state', 'lyric-timeline']) {
    const input = { trackTitle: 'Internal song', artists: ['Artist'], coverUrl: `https://example.test/${kind}.jpg`,
      playing: true, status: 'empty', lines: [], generation: 10, sequence: 1 };
    let result;
    await routes[`POST /api/playback/${kind}`](context, { body: async () => input }, {
      writeHead(status) { assert.equal(status, 200); },
      end(body) { result = JSON.parse(body); },
    });
    assert.equal(runtime.getNowPlayingState().coverUrl, input.coverUrl, kind);
    assert.equal(Object.hasOwn(result.data, 'coverUrl'), false, 'artwork belongs to now-playing, not lyric responses');
  }
});

test('now-playing publishes track and playback changes once, rejects stale artwork, and clears it on a new track', async (t) => {
  const { runtime, messages } = await fixture(t);
  const input = { trackTitle: 'Instrumental', artists: ['Artist'], coverUrl: 'https://example.test/current.jpg',
    playing: true, status: 'empty', generation: 10, sequence: 1 };
  runtime.publishLyricState(input);
  const updates = () => messages.filter(message => message.type === 'now-playing');
  assert.equal(updates().length, 1);
  assert.equal(runtime.getNowPlayingState().playing, true);
  for (let sequence = 2; sequence <= 10; sequence++) runtime.publishLyricState({ ...input, sequence, currentMs: sequence * 100 });
  assert.equal(updates().length, 1, 'lyric clock ticks do not create metadata broadcasts');
  runtime.publishLyricState({ ...input, sequence: 11, playing: false });
  assert.equal(updates().length, 2);
  runtime.publishLyricState({ ...input, sequence: 10, coverUrl: 'https://example.test/stale.jpg' });
  assert.equal(runtime.getNowPlayingState().coverUrl, input.coverUrl);
  assert.equal(runtime.getNowPlayingState().playing, false);
  runtime.publishLyricTimeline({ trackTitle: 'Next track', artists: ['Another artist'], lines: [] });
  assert.equal(runtime.getNowPlayingState().trackTitle, 'Next track');
  assert.equal(runtime.getNowPlayingState().coverUrl, '');
  assert.equal(updates().length, 3);
  runtime.publishLyricState({ trackTitle: 'Next track', coverUrl: 'file:///private/cover.png', playing: true, generation: 20, sequence: 1 });
  assert.equal(runtime.getNowPlayingState().coverUrl, '', 'private local file paths cannot reach browser sources');
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
