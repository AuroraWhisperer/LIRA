'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = (file) => path.join(__dirname, '../../public/js/playback', file);

test('lyric results retain their request generation when playback returns to the same song', async () => {
  const { createPlaybackControls } = await loadModuleExports(entry('features/playback-controls.js'));
  const { createPlaybackStateActions } = await loadModuleExports(entry('state/actions.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  const requests = [];
  const publications = [];
  const controls = createPlaybackControls({
    playbackState: state,
    stateActions: createPlaybackStateActions(state),
    lyricService: { loadLyrics: track => new Promise(resolve => requests.push({ track, resolve })) },
    syncPlaybackLyricWindow: () => publications.push(state.current.lyrics),
  });
  state.current = { id: 'a', source: 'qq' };
  const firstA = controls.loadPlaybackLyrics(state.current);
  controls.invalidatePlaybackRequests();
  state.current = { id: 'b', source: 'qq' };
  const oldB = controls.loadPlaybackLyrics(state.current);
  controls.invalidatePlaybackRequests();
  state.current = { id: 'a', source: 'qq' };
  const currentA = controls.loadPlaybackLyrics(state.current);
  const lyrics = { lines: [{ text: 'Current A' }] };
  requests[2].resolve(lyrics);
  await currentA;
  requests[0].resolve(null);
  requests[1].resolve({ lines: [{ text: 'Old B' }] });
  await Promise.all([firstA, oldB]);
  assert.equal(state.current.lyrics, lyrics);
  assert.deepEqual(publications, [lyrics]);
  const olderReload = controls.loadPlaybackLyrics(state.current);
  const newerReload = controls.loadPlaybackLyrics(state.current);
  const latest = { lines: [{ text: 'Refreshed A' }] };
  requests[4].resolve(latest);
  await newerReload;
  requests[3].resolve(null);
  await olderReload;
  assert.equal(state.current.lyrics, latest);
  assert.deepEqual(publications, [lyrics, latest]);
});

test('forgetting provider streams covers every playable collection while retaining other providers and lyrics', async () => {
  const { createPlaybackStateActions } = await loadModuleExports(entry('state/actions.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  const lyrics = { lines: [{ text: '歌词' }] };
  const netease = { source: 'netease', playUrl: 'https://example.test/old.mp3', playUrlExpireAt: 123, lyrics };
  const qq = { source: 'qq', playUrl: 'https://example.test/qq.mp3' };
  state.current = { ...netease };
  const collections = ['requestedQueue', 'normalQueue', 'normalQueueTracks', 'radioQueue', 'history', 'displayHistory'];
  for (const collection of collections) state[collection] = [{ ...netease }, { ...qq }];
  createPlaybackStateActions(state).forgetProviderStreams('netease');
  for (const cleared of [state.current, ...collections.map((name) => state[name][0])]) {
    assert.equal(cleared.playUrl, undefined);
    assert.equal(cleared.playUrlExpireAt, undefined);
    assert.equal(cleared.lyrics, lyrics);
  }
  for (const collection of collections) assert.equal(state[collection][1].playUrl, qq.playUrl);
});

test('state actions preserve reader identity and publish only after a completed change', async () => {
  const { createPlaybackStateActions } = await loadModuleExports(entry('state/actions.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  const reader = state;
  const calls = [];
  const actions = createPlaybackStateActions(state, {
    save: () => calls.push(['save', reader.current.id, reader.mode]),
    render: () => calls.push(['render', reader.current.id, reader.mode]),
  });
  actions.restore({ mode: 'shuffle', current: { id: 'old' } });
  actions.beginTrack({ id: 'next' }, { origin: 'normal' });
  assert.equal(reader, state);
  assert.deepEqual(calls, []);
  actions.commit();
  assert.deepEqual(calls, [
    ['save', 'next', 'shuffle'],
    ['render', 'next', 'shuffle'],
  ]);
  assert.equal(reader.history[0].id, 'old');
  assert.equal(actions.setLyrics('old', { lines: ['stale'] }), false);
  assert.equal(reader.current.lyrics, undefined);
  assert.equal(actions.setLyrics('next', { lines: ['current'] }), true);
  assert.deepEqual(reader.current.lyrics.lines, ['current']);
});

test('queue owner consumes persisted shuffle IDs once and keeps playlist position aligned', async () => {
  const { QueueManager } = await loadModuleExports(entry('queue/manager.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  const queue = new QueueManager({ state });
  queue.startCollection([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 0, 'playlist');
  state.mode = 'shuffle';
  state.shuffleOrder = ['c', 'b'];
  assert.equal(queue.takeNext().track.id, 'c');
  assert.equal(state.playlistIndex, 2);
  assert.equal(queue.takeNext().track.id, 'b');
  assert.equal(state.playlistIndex, 1);
  assert.equal(queue.takeNext(), null);
  assert.equal(queue.jumpToPlaylistTrack(0).id, 'a');
  assert.equal(new Set([queue.takeNext().track.id, queue.takeNext().track.id]).size, 2);
  assert.equal(queue.takeNext(), null);
});

test('explicit next priority survives shuffle rebuilds and keeps same-song request positions separate', async () => {
  const { QueueManager } = await loadModuleExports(entry('queue/manager.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  const queue = new QueueManager({ state });
  queue.startCollection([{ id: 'same-song' }, { id: 'old-next' }], 0, 'playlist');
  state.mode = 'shuffle';
  queue.insertTracksNext([
    { id: 'same-song', songRequestKey: 'first-request' },
    { id: 'same-song', songRequestKey: 'second-request' },
  ]);
  queue.appendTracks([{ id: 'appended' }]);
  queue.rebuildShuffleOrder();
  state.shuffleOrder = ['appended', 'old-next', 'request:second-request', 'request:first-request'];
  const first = queue.takeNext().track;
  assert.equal(first.songRequestKey, 'first-request');
  assert.equal(first.playNext, undefined);
  assert.equal(state.playlistIndex, 1);
  assert.equal(queue.takeNext().track.songRequestKey, 'second-request');
  assert.equal(state.playlistIndex, 2);
  assert.equal(state.normalQueueTracks.some((track) => track.playNext), false);
  assert.equal(queue.takeNext().track.id, 'appended');
  assert.equal(queue.takeNext().track.id, 'old-next');
  assert.equal(queue.takeNext(), null);
});

test('playlist cursor follows the consumed song after shuffle changes to sequence', async () => {
  const { QueueManager } = await loadModuleExports(entry('queue/manager.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  const queue = new QueueManager({ state });
  queue.startCollection([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], 0, 'playlist');
  state.mode = 'shuffle';
  state.shuffleOrder = ['d', 'b', 'c'];
  assert.equal(queue.takeNext().track.id, 'd');
  assert.equal(state.playlistIndex, 3);
  state.mode = 'sequence';
  assert.equal(queue.takeNext().track.id, 'b');
  assert.equal(state.playlistIndex, 1);
  assert.equal(queue.takeNext().track.id, 'c');
  assert.equal(state.playlistIndex, 2);
});

test('sequential duplicate tracks and separate same-song requests keep their own playlist positions', async () => {
  const { QueueManager } = await loadModuleExports(entry('queue/manager.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  const queue = new QueueManager({ state });
  queue.startCollection([
    { id: 'a' }, { id: 'a' },
    { id: 'a', songRequestKey: 'request-1' }, { id: 'a', songRequestKey: 'request-2' },
  ], 0, 'playlist');
  for (const index of [1, 2, 3]) {
    state.current = queue.takeNext().track;
    assert.equal(state.playlistIndex, index);
    assert.equal(queue.getPreviousPlaylistIndex(), index - 1);
  }
});

test('a radio started without a collection key records the track platform', async () => {
  const { QueueManager } = await loadModuleExports(entry('queue/manager.js'));
  const { createInitialState } = await loadModuleExports(entry('state/manager.js'));
  const state = createInitialState();
  state.selectedSource = 'netease';
  const queue = new QueueManager({ state });
  queue.startCollection([{ id: 'qq-song', source: 'qq' }], 0, 'radio');
  assert.equal(state.queueSourceKey, 'qq:radio');
});
