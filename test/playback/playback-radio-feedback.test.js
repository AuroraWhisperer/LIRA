'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('playback save notifications follow the latest response and allow a new failure episode', async () => {
  const notices = [];
  const requests = [];
  const { createInitialState } = await loadModuleExports(path.resolve('public/js/playback/state/manager.js'));
  const { createStatePersistence } = await loadModuleExports(path.resolve('public/js/playback/operations/state-persistence.js'), {
    setTimeout: () => 1, clearTimeout() {},
    fetch: () => {
      const pending = Promise.withResolvers();
      requests.push(pending);
      return pending.promise;
    },
  });
  const persistence = createStatePersistence({ playbackState: createInitialState(), getPlaybackAudio: () => null,
    snapshotWriter: { writerId: 'test', generation: 1 },
    toast: (message, options) => notices.push({ message, ...options }),
  });
  const save = () => {
    persistence.savePlaybackState();
    return persistence.flushPlaybackStateSave();
  };
  for (let i = 0; i < 3; i++) {
    const saving = save();
    if (i === 0) requests.at(-1).reject(new Error('offline'));
    else requests.at(-1).resolve({ ok: false });
    await saving;
    assert.equal(notices.length, i === 0 ? 0 : 1);
  }
  assert.equal(notices[0].type, 'warning');
  const late = save();
  const lateRequest = requests.at(-1);
  const recovery = save();
  requests.at(-1).resolve({ ok: true });
  await recovery;
  assert.equal(notices.length, 2);
  assert.equal(notices[1].type, 'success');
  lateRequest.resolve({ ok: false });
  await late;
  for (let i = 0; i < 2; i++) {
    const saving = save();
    requests.at(-1).resolve({ ok: false });
    await saving;
    assert.equal(notices.length, i === 0 ? 2 : 3, 'late failure must not count against recovery');
  }
});

test('radio refill notifies once on repeated failure or empty queue, then reports recovery', async () => {
  const notices = [];
  const requests = [];
  const { createRadioMode } = await loadModuleExports(path.resolve('public/js/playback/features/radio-mode.js'), {
    console: { warn() {} },
    fetch: () => {
      const pending = Promise.withResolvers();
      requests.push(pending);
      return pending.promise;
    },
  });
  const state = { queueType: 'radio', selectedSource: 'qq', radioQueue: [{ id: 'last' }] };
  const { ensurePlaybackRadioQueueFilled: refill } = createRadioMode({
    playbackState: state, playbackRadioRefillThreshold: 3, playbackRadioRefillBatchSize: 5,
    readJsonResponse: async (response) => response,
    queueManager: { refillRadioQueue: (tracks) => state.radioQueue.push(...tracks) },
    savePlaybackState() {}, renderPlayback() {},
    toast: (message, options) => notices.push({ message, ...options }),
  });
  for (let i = 0; i < 3; i++) {
    const filling = refill();
    requests.at(-1).reject(new Error('offline'));
    await filling;
    assert.equal(notices.length, i === 0 ? 0 : 1);
  }
  const recovery = refill();
  requests.at(-1).resolve({ ok: true, data: { tracks: [{ id: 'new', title: '新歌' }] } });
  await recovery;
  assert.equal(notices.length, 2);
  assert.match(notices[1].message, /已补上新歌/);
  assert.equal(notices[1].type, 'success');
  state.radioQueue = [];
  const empty = refill();
  requests.at(-1).resolve({ ok: true, data: { tracks: [] } });
  await empty;
  assert.equal(notices.length, 3);
  const switched = refill();
  state.selectedSource = 'netease';
  requests.at(-1).reject(new Error('late old provider failure'));
  await switched;
  assert.equal(notices.length, 3);
});
