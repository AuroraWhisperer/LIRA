'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createQQClientCapture } = require('../../src/music/qq-client-capture');

const LYRICS = { source: 'qq', lines: [{ startMs: 0, text: 'First' }, { startMs: 10000, text: 'Second' }] };
const tick = () => new Promise(setImmediate);

function fixture(t, resolveLyrics = async () => LYRICS) {
  let sample;
  let stops = 0;
  let currentTime = 100000;
  const states = [];
  const timelines = [];
  const capture = createQQClientCapture({
    platform: 'win32', now: () => currentTime, resolveLyrics,
    monitorFactory(callback) { sample = callback; return { start() {}, stop() { stops++; } }; },
    onState: (status, lyricState) => states.push({ status, lyricState }),
    onTimeline: (timeline) => timelines.push(timeline),
  });
  t.after(() => capture.stop());
  capture.setActive(true);
  const send = (changes = {}) => sample({
    detected: true, appId: 'QQMusic.exe', title: 'Song', artist: 'Artist', playbackStatus: 'Playing',
    positionMs: 15000, durationMs: 180000, timelineUpdatedAt: 99500, ...changes,
  });
  return { capture, states, timelines, send, setNow: (value) => { currentTime = value; }, getStops: () => stops };
}

test('QQ follows pause, resume and seek without resolving lyrics again', async (t) => {
  let resolutions = 0;
  const { capture, send, states } = fixture(t, async () => { resolutions++; return LYRICS; });
  send(); send(); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(states.at(-1).lyricState.lineText, 'Second');
  send({ playbackStatus: 'Paused' });
  assert.equal(capture.getStatus().playing, false);
  assert.equal(capture.getStatus().status, 'ready', 'old timestamps are valid while paused');
  send({ positionMs: 3000, timelineUpdatedAt: 100000 });
  assert.equal(states.at(-1).lyricState.lineText, 'First');
  assert.equal(states.at(-1).lyricState.playing, true);
  assert.equal(resolutions, 1);
});

test('QQ waits for a fresh timeline after Stopped/Changing metadata handoff', async (t) => {
  const titles = [];
  const { capture, send } = fixture(t, async (track) => { titles.push(track.title); return LYRICS; });
  send(); send(); await tick();
  send({ playbackStatus: 'Stopped' });
  send({ title: 'New song', playbackStatus: 'Changing', timelineUpdatedAt: 99700 });
  send({ title: 'New song', timelineUpdatedAt: 99700 });
  await tick();
  assert.equal(capture.getStatus().status, 'loading');
  assert.deepEqual(titles, ['Song'], 'new title with the previous song clock must not resolve or publish');
  send({ title: 'New song', positionMs: 400, timelineUpdatedAt: 100000 });
  await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getStatus().currentMs, 400);
  assert.deepEqual(titles, ['Song', 'New song']);
});

test('late QQ lyrics cannot replace a newer track or reactivate a stopped capture', async (t) => {
  const pending = [];
  const { capture, send, timelines, getStops } = fixture(t, () => {
    const result = Promise.withResolvers(); pending.push(result); return result.promise;
  });
  send(); send();
  send({ title: 'New song', timelineUpdatedAt: 99700 });
  send({ title: 'New song', timelineUpdatedAt: 100000 });
  pending[1].resolve({ ...LYRICS, lines: [{ startMs: 0, text: 'New lyric' }] });
  await tick();
  pending[0].resolve(LYRICS); await tick();
  assert.equal(timelines.at(-1).lines[0].text, 'New lyric');
  capture.refresh(); send(); send();
  capture.setActive(false);
  pending[2].resolve(LYRICS); await tick();
  assert.equal(capture.getStatus().active, false);
  assert.equal(timelines.at(-1).lines.length, 0);
  assert.equal(getStops(), 2);
});

test('QQ lyrics arriving during an invalid clock remain hidden until a usable sample', async (t) => {
  const result = Promise.withResolvers();
  const { capture, send, states } = fixture(t, () => result.promise);
  send(); send();
  send({ playbackStatus: 'Changing' });
  result.resolve(LYRICS); await tick();
  assert.equal(capture.getStatus().status, 'loading');
  assert.equal(states.at(-1).lyricState.playing, false);
  send({ timelineUpdatedAt: 100000, positionMs: 16000 });
  assert.equal(capture.getStatus().status, 'ready');
});

test('QQ ignores the old clock published alongside a new title even when it has a newer timestamp', async (t) => {
  const requests = [];
  const { capture, send, timelines } = fixture(t, async (track) => { requests.push(track); return LYRICS; });
  send(); send(); await tick();
  send({ title: 'Next', positionMs: 15700, timelineUpdatedAt: 99700 });
  send({ title: 'Next', positionMs: 15700, timelineUpdatedAt: 99700 });
  assert.equal(capture.getStatus().status, 'loading');
  assert.equal(requests.length, 1);
  assert.equal(timelines.filter((timeline) => timeline.trackTitle === 'Next').length, 1);
  send({ title: 'Next', positionMs: 1000, durationMs: 210000, timelineUpdatedAt: 100000 });
  await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(requests[1].durationMs, 210000, 'match using the new song duration');
});

test('QQ exposes empty and error separately and retry starts a fresh monitor', async (t) => {
  let calls = 0;
  const { capture, send, setNow, getStops } = fixture(t, async () => {
    if (++calls === 1) return null;
    throw new Error('provider unavailable');
  });
  send(); send(); await tick();
  assert.equal(capture.getStatus().status, 'empty');
  capture.refresh(); send(); send(); await tick();
  assert.equal(capture.getStatus().status, 'error');
  assert.equal(getStops(), 1);
  send({ detected: false });
  setNow(101500); send({ detected: false });
  assert.equal(capture.getStatus().status, 'waiting');
});

test('QQ rejects unsupported platforms without starting a process', () => {
  const capture = createQQClientCapture({ platform: 'linux', monitorFactory: () => assert.fail('must not launch') });
  assert.throws(() => capture.setActive(true), /Windows/);
  assert.equal(capture.getStatus().active, false);
});

test('QQ rejects absent or regressing timeline samples and recovers without reloading lyrics', async (t) => {
  let resolutions = 0;
  const { capture, send, states } = fixture(t, async () => { resolutions++; return LYRICS; });
  send({ positionMs: null }); send({ positionMs: null });
  assert.equal(capture.getStatus().status, 'loading');
  assert.equal(resolutions, 0);
  send(); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  send({ timelineUpdatedAt: 95000 });
  assert.equal(capture.getStatus().status, 'loading');
  assert.equal(states.at(-1).lyricState.lineText, '');
  send({ timelineUpdatedAt: 100000 });
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(resolutions, 1);
});

test('QQ advances a stable SMTC anchor at the reported playback rate', async (t) => {
  const { capture, send, setNow } = fixture(t);
  const anchor = { positionMs: 2000, timelineUpdatedAt: 90000, playbackRate: 1.5 };
  send(anchor); send(anchor); await tick();
  assert.equal(capture.getStatus().status, 'ready', 'LastUpdatedTime is not a freshness deadline');
  assert.equal(capture.getStatus().currentMs, 17000);
  setNow(105000); send(anchor);
  assert.equal(capture.getStatus().currentMs, 24500);
  send({ playbackStatus: 'Paused', positionMs: 24500, timelineUpdatedAt: 105000 });
  setNow(110000);
  send({ playbackStatus: 'Paused', positionMs: 24500, timelineUpdatedAt: 105000 });
  assert.equal(capture.getStatus().currentMs, 24500);
  send({ positionMs: 179000, timelineUpdatedAt: 105000 });
  assert.equal(capture.getStatus().currentMs, 180000, 'elapsed playback is capped by song duration');
});

test('QQ keeps actual playback visible to arbitration while lyrics or clock are unavailable', async (t) => {
  const { capture, send, states } = fixture(t, async () => null);
  send({ positionMs: null }); send({ positionMs: null });
  assert.equal(capture.getStatus().playing, true);
  assert.equal(states.at(-1).lyricState.playing, false);
  send(); await tick();
  assert.equal(capture.getStatus().status, 'empty');
  assert.equal(capture.getStatus().playing, true);
  assert.equal(states.at(-1).lyricState.playing, false);
});

test('QQ tolerates one absent session sample but clears a sustained absence', async (t) => {
  let resolutions = 0;
  const { capture, send, setNow } = fixture(t, async () => { resolutions++; return LYRICS; });
  send(); send(); await tick();
  send({ detected: false });
  assert.equal(capture.getStatus().status, 'ready');
  setNow(100500); send(); await tick();
  assert.equal(resolutions, 1);
  send({ detected: false });
  setNow(102000); send({ detected: false });
  assert.equal(capture.getStatus().status, 'waiting');
  assert.equal(capture.getStatus().playing, false);
});

test('QQ accepts an already updated new-track anchor after metadata settles', async (t) => {
  const { capture, send } = fixture(t);
  send(); send(); await tick();
  const next = { title: 'Next', positionMs: 300, durationMs: 210000, timelineUpdatedAt: 100000 };
  send(next); send(next); await tick();
  assert.equal(capture.getStatus().status, 'ready');
  assert.equal(capture.getStatus().currentMs, 300);
});

test('QQ exposes independent lyric snapshots for switching to an already playing source', async (t) => {
  const { capture, send } = fixture(t);
  send(); send(); await tick();
  const timeline = capture.getTimeline();
  const lyricState = capture.getLyricState();
  assert.equal(timeline.lines[1].text, 'Second');
  assert.equal(lyricState.lineText, 'Second');
  timeline.lines[1].text = 'Changed';
  timeline.artists[0] = 'Changed';
  lyricState.artists[0] = 'Changed';
  assert.equal(capture.getTimeline().lines[1].text, 'Second');
  assert.deepEqual(capture.getStatus().artists, ['Artist']);
  send({ playbackStatus: 'Changing' });
  assert.deepEqual(capture.getTimeline().lines, []);
  capture.stop();
  assert.equal(capture.getLyricState().status, 'idle');
});
