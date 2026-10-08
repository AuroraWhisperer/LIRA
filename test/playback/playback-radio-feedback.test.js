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

async function createRadioFixture() {
  const notices = [];
  const requests = [];
  const updates = [];
  const { createInitialState } = await loadModuleExports(path.resolve('public/js/playback/state/manager.js'));
  const { QueueManager } = await loadModuleExports(path.resolve('public/js/playback/queue/manager.js'));
  const { createRadioMode } = await loadModuleExports(path.resolve('public/js/playback/features/radio-mode.js'), {
    console: { warn() {} },
    fetch: (url, options) => {
      const pending = Promise.withResolvers();
      requests.push({ ...pending, body: JSON.parse(options.body) });
      return pending.promise;
    },
  });
  const state = createInitialState();
  const queueManager = new QueueManager({ state });
  const startRadio = (source) => {
    state.selectedSource = source;
    state.current = queueManager.startCollection([
      { id: `${source}:current`, source, title: '当前曲目' },
      { id: `${source}:last`, source, title: '下一曲目' },
    ], 0, 'radio', '电台', `${source}:radio`);
  };
  startRadio('qq');
  const { ensurePlaybackRadioQueueFilled: refill } = createRadioMode({
    playbackState: state, playbackRadioRefillThreshold: 3, playbackRadioRefillBatchSize: 5,
    readJsonResponse: async (response) => response,
    queueManager,
    savePlaybackState() { updates.push('save'); }, renderPlayback() { updates.push('render'); },
    toast: (message, options) => notices.push({ message, ...options }),
  });
  return { state, startRadio, refill, requests, notices, updates };
}

test('radio refill notifies once on repeated failure or empty queue, then reports recovery', async () => {
  const { state, startRadio, refill, requests, notices } = await createRadioFixture();
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
  state.radioQueue.length = 0;
  const empty = refill();
  requests.at(-1).resolve({ ok: true, data: { tracks: [] } });
  await empty;
  assert.equal(notices.length, 3);
  const switched = refill();
  startRadio('netease');
  requests.at(-1).reject(new Error('late old provider failure'));
  await switched;
  assert.equal(notices.length, 3);
});

test('radio refill keeps its provider when another music tab is selected', async () => {
  const { state, refill, requests } = await createRadioFixture();
  state.selectedSource = 'netease';
  const filling = refill();
  assert.equal(requests[0].body.platform, 'qq');
  assert.equal(requests[0].body.action, 'radio');
  await refill();
  assert.equal(requests.length, 1, 'the active radio has only one refill in flight');
  requests[0].resolve({ ok: true, data: { tracks: [{ id: 'qq:new', source: 'qq' }] } });
  await filling;
  assert.deepEqual(Array.from(state.radioQueue, (track) => track.id), ['qq:last', 'qq:new']);
});

test('restored radio without a source key uses its tracks before the browsing tab', async () => {
  const { state, refill, requests } = await createRadioFixture();
  state.queueSourceKey = '';
  state.selectedSource = 'netease';
  const filling = refill();
  assert.equal(requests[0].body.platform, 'qq');
  requests[0].resolve({ ok: true, data: { tracks: [] } });
  await filling;
});

for (const source of ['netease', 'qq']) {
  test(`a new ${source} radio can refill while an old request is pending and ignores its result`, async () => {
    const { state, startRadio, refill, requests, notices, updates } = await createRadioFixture();
    const oldFilling = refill();
    startRadio(source);
    const newFilling = refill();
    assert.equal(requests.length, 2, 'the new radio does not wait for the old request');
    assert.equal(requests[1].body.platform, source);
    requests[0].resolve({ ok: true, data: { tracks: [{ id: 'qq:old-result', source: 'qq' }] } });
    await oldFilling;
    assert.deepEqual(Array.from(state.radioQueue, (track) => track.id), [`${source}:last`]);
    assert.deepEqual(updates, [], 'the old response does not save or rerender the new radio');
    assert.deepEqual(notices, []);
    await refill();
    assert.equal(requests.length, 2, 'completion of the old request cannot unlock the new refill');
    requests[1].resolve({ ok: true, data: { tracks: [{ id: `${source}:new-result`, source }] } });
    await newFilling;
    assert.deepEqual(Array.from(state.radioQueue, (track) => track.id), [`${source}:last`, `${source}:new-result`]);
    assert.deepEqual(updates, ['save', 'render']);
  });

  test(`late failures cannot count against the new ${source} radio`, async () => {
    const { startRadio, refill, requests, notices } = await createRadioFixture();
    const oldFilling = refill();
    startRadio(source);
    const newFilling = refill();
    requests[0].reject(new Error('late old provider failure'));
    await oldFilling;
    requests[1].reject(new Error('new provider failure'));
    await newFilling;
    assert.deepEqual(notices, [], 'only the first failure belongs to the new radio');
    const retry = refill();
    requests[2].reject(new Error('new provider retry failure'));
    await retry;
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, 'warning');
  });
}
