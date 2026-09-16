'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const entry = (file) => path.join(__dirname, '../public/js/playback', file);

test('state actions preserve reader identity and publish only after a completed change', async () => {
  const { createPlaybackStateActions } = await loadModuleExports(
    entry('state/actions.js'),
  );
  const { createInitialState } = await loadModuleExports(
    entry('state/manager.js'),
  );
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
  const { createInitialState } = await loadModuleExports(
    entry('state/manager.js'),
  );
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
  assert.equal(
    new Set([queue.takeNext().track.id, queue.takeNext().track.id]).size,
    2,
  );
  assert.equal(queue.takeNext(), null);
});
