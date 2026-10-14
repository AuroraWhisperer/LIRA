'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNeteaseClientCapture } = require('../../src/music/netease-client-capture');

const LYRICS = { source: 'netease', lines: [{ startMs: 0, text: 'First' }, { startMs: 10000, text: 'Second' }] };
const tick = () => new Promise(setImmediate);

function fixture(t, resolveLyrics = async () => LYRICS) {
  let sample;
  let time = 100000;
  let stops = 0;
  const timelines = [];
  const capture = createNeteaseClientCapture({
    platform: 'win32', now: () => time, resolveLyrics,
    monitorFactory(callback) { sample = callback; return { start() {}, stop() { stops++; } }; },
    onTimeline: (timeline) => timelines.push(timeline),
  });
  t.after(() => capture.stop());
  capture.setActive(true);
  return {
    capture, timelines, advance(ms) { time += ms; }, getStops: () => stops,
    send(changes = {}) {
      sample({ detected: true, title: 'Song', artists: ['Artist'], sourceTrackId: '123',
        clockSource: 'uia', playbackStatus: 'Playing', positionMs: 15000, durationMs: 180000,
        timelineUpdatedAt: time, ...changes });
    },
  };
}

test('NetEase uses its exact song ID and follows pause, resume and seeks without reloading', async (t) => {
  const requests = [];
  const { capture, send, advance } = fixture(t, async (track) => { requests.push(track); return LYRICS; });
  send(); send(); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getLyricState().lineText, 'Second');
  assert.deepEqual(requests, [{ title: 'Song', artists: ['Artist'], durationMs: 180000, sourceTrackId: '123' }]);
  advance(500); send();
  assert.equal(capture.getStatus().currentMs, 15500, 'interpolate the one-second UIA display');
  advance(20000); send({ playbackStatus: 'Paused' });
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getStatus().playing, false);
  assert.equal(capture.getStatus().currentMs, 15000);
  send({ positionMs: 3000 });
  assert.equal(capture.getLyricState().lineText, 'First');
  assert.equal(capture.getStatus().playing, true);
  assert.equal(requests.length, 1);
  const timeline = capture.getTimeline();
  timeline.lines[0].text = 'Changed';
  assert.equal(capture.getTimeline().lines[0].text, 'First', 'arbitration snapshots cannot mutate capture data');
});

test('NetEase preserves a continuous UIA clock across delayed integer-second observations', async (t) => {
  const { capture, send, advance } = fixture(t);
  send(); send(); await tick();
  for (let elapsed = 550; elapsed <= 22000; elapsed += 550) {
    const previous = capture.getStatus().currentMs;
    advance(550);
    send({ positionMs: Math.floor((15900 + elapsed) / 1000) * 1000 });
    assert.equal(capture.getStatus().status, 'ready');
    assert.ok(capture.getStatus().currentMs >= previous + 550, 'a later observation of the next second must not rewind');
  }
  send({ positionMs: 16000 });
  assert.equal(capture.getStatus().currentMs, 16000, 'an actual backward seek still resets the clock');
});

test('NetEase discards frozen UIA clocks but keeps actual playback independent of lyric readiness', async (t) => {
  const result = Promise.withResolvers();
  const { capture, send, advance } = fixture(t, () => result.promise);
  send(); send();
  assert.equal(capture.getStatus().playing, true);
  assert.equal(capture.getStatus().status, 'loading');
  advance(3000); send();
  result.resolve(LYRICS); await tick();
  assert.equal(capture.getStatus().status, 'loading');
  assert.equal(capture.getStatus().playing, true);
  assert.equal(capture.getLyricState().playing, false);
  assert.equal(capture.getTimeline().lines.length, 0);
  send({ positionMs: 18000 });
  assert.equal(capture.getStatus().status, 'ready');
});

test('NetEase waits for new UIA controls before resolving a changed title and rejects late lyrics', async (t) => {
  const pending = [];
  const { capture, send, advance, timelines } = fixture(t, (track) => {
    const result = Promise.withResolvers(); pending.push({ ...result, track }); return result.promise;
  });
  send(); send();
  advance(500); send({ title: 'Next', sourceTrackId: '456' });
  advance(500); send({ title: 'Next', sourceTrackId: '456' });
  pending[0].resolve(LYRICS); await tick();
  assert.equal(pending.length, 1);
  assert.equal(capture.getTimeline().lines.length, 0);
  advance(1000); send({ title: 'Next', sourceTrackId: '456', positionMs: 1000, durationMs: 210000 });
  assert.equal(pending[1].track.durationMs, 210000);
  pending[1].resolve({ ...LYRICS, lines: [{ startMs: 0, text: 'Next lyric' }] }); await tick();
  assert.equal(timelines.at(-1).lines[0].text, 'Next lyric');
  capture.refresh(); send(); send();
  capture.stop(); pending[2].resolve(LYRICS); await tick();
  assert.equal(capture.getStatus().active, false);
  assert.equal(capture.getTimeline().lines.length, 0);
});

test('NetEase accepts long-lived SMTC anchors and requires a new anchor at song handoff', async (t) => {
  const { capture, send, advance } = fixture(t);
  const smtc = { clockSource: 'smtc', timelineUpdatedAt: 90000 };
  send(smtc); send(smtc); await tick();
  assert.equal(capture.getStatus().currentMs, 25000);
  advance(500); send(smtc);
  assert.equal(capture.getStatus().currentMs, 25500);
  send({ ...smtc, title: 'Next', sourceTrackId: '456' });
  send({ ...smtc, title: 'Next', sourceTrackId: '456' });
  assert.equal(capture.getStatus().status, 'loading');
  send({ clockSource: 'smtc', title: 'Next', sourceTrackId: '456', positionMs: 1000 }); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getStatus().currentMs, 1000);
});

test('a NetEase Stopped sample does not make the previous SMTC song clock valid again', async (t) => {
  const requests = [];
  const { capture, send } = fixture(t, async (track) => { requests.push(track); return LYRICS; });
  const smtc = { clockSource: 'smtc', timelineUpdatedAt: 90000 };
  send(smtc); send(smtc); await tick();
  send({ ...smtc, playbackStatus: 'Stopped' });
  send({ ...smtc, title: 'Next', sourceTrackId: '456' });
  send({ ...smtc, title: 'Next', sourceTrackId: '456' });
  assert.equal(capture.getStatus().status, 'loading');
  assert.equal(requests.length, 1);
  send({ clockSource: 'smtc', title: 'Next', sourceTrackId: '456', positionMs: 1000 }); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(requests.length, 2);
});

test('NetEase accepts a new song sole SMTC anchor after a position reset and rejects regressing anchors', async (t) => {
  const requests = [];
  const { capture, send, advance } = fixture(t, async (track) => { requests.push(track); return LYRICS; });
  const smtc = { clockSource: 'smtc', timelineUpdatedAt: 90000 };
  send(smtc); send(smtc); await tick();
  advance(500);
  const next = { clockSource: 'smtc', title: 'Next', sourceTrackId: '456', timelineUpdatedAt: 100000, positionMs: 0 };
  send(next); send(next); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getStatus().currentMs, 500);
  assert.deepEqual(requests.map((track) => track.title), ['Song', 'Next']);
  send({ ...next, timelineUpdatedAt: 95000, positionMs: 50000 });
  assert.equal(capture.getStatus().status, 'loading');
  assert.equal(capture.getTimeline().lines.length, 0);
  send(next);
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(requests.length, 2);
});

test('NetEase UIA fallback timestamps do not invalidate the unchanged SMTC anchor when it recovers', async (t) => {
  const { capture, send, advance } = fixture(t);
  const smtc = { clockSource: 'smtc', timelineUpdatedAt: 90000 };
  send(smtc); send(smtc); await tick();
  advance(500); send({ positionMs: 25000 });
  assert.equal(capture.getStatus().status, 'ready');
  advance(500); send(smtc);
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getStatus().currentMs, 26000);
});

test('NetEase can infer playback from advancing UIA time without confusing a paused seek with playback', async (t) => {
  const { capture, send, advance } = fixture(t);
  send({ playbackStatus: 'Unknown' });
  advance(1000); send({ playbackStatus: 'Unknown', positionMs: 16000 });
  assert.equal(capture.getStatus().playing, false, 'a single paused seek can also advance the displayed second');
  advance(1000); send({ playbackStatus: 'Unknown', positionMs: 17000 }); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getStatus().playing, true);
  advance(500); send({ playbackStatus: 'Unknown', positionMs: 60000 });
  assert.equal(capture.getStatus().playing, false);
  assert.equal(capture.getStatus().status, 'loading');
});

test('a late matching local ID reloads the same song once and keeps unrelated IDs out', async (t) => {
  const requests = [];
  const { capture, send } = fixture(t, async (track) => { requests.push(track); return LYRICS; });
  send({ sourceTrackId: '' }); send({ sourceTrackId: '' }); await tick();
  send({ sourceTrackId: '123' }); await tick();
  send({ sourceTrackId: '../credential' });
  assert.deepEqual(requests.map((track) => track.sourceTrackId), ['', '123']);
  assert.equal(capture.getStatus().status, 'ready');
});

test('NetEase empty, errors, missing client and refresh remain distinguishable', async (t) => {
  let calls = 0;
  const { capture, send, getStops } = fixture(t, async () => {
    if (++calls === 1) return null;
    throw new Error('provider unavailable');
  });
  send(); send(); await tick();
  assert.equal(capture.getStatus().status, 'empty');
  capture.refresh(); send(); send(); await tick();
  assert.equal(capture.getStatus().status, 'error');
  assert.equal(capture.getStatus().playing, true);
  send({ detected: false });
  assert.equal(capture.getStatus().status, 'waiting');
  assert.equal(capture.getStatus().playing, false);
  assert.equal(getStops(), 1);
});

test('NetEase rejects unsupported platforms before starting a helper', () => {
  const capture = createNeteaseClientCapture({ platform: 'linux', monitorFactory: () => assert.fail('must not launch') });
  assert.throws(() => capture.setActive(true), /Windows/);
  assert.equal(capture.getStatus().active, false);
});
