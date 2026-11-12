'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createPlaybackApp, flushAsyncWork } = require('../helpers/playback-app');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');

test('radio continues beyond its initial page and preserves its position after restoring playback', async () => {
  const provider = new NeteaseMusicProvider();
  const songs = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1, name: `Radio song ${index + 1}`, dt: 180000,
    al: { picUrl: 'https://example.invalid/cover.png' }, ar: [{ name: 'Artist' }],
  }));
  provider.requestJson = async () => ({ result: songs });
  const options = {
    homeAction: 'radio', authState: { platform: 'netease', loggedIn: true },
    loadHome: async (request) => ({ tracks: await provider.getRadioTracks(request) }),
  };
  let app = await createPlaybackApp({ current: null, selectedSource: 'netease', mode: 'sequence', volume: 0.75 }, options);
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  await app.emit('playbackDrawerRefresh', 'click');
  await flushAsyncWork();
  await app.emit('playbackDrawerActions', 'click', { target: { id: 'playbackDrawerPlayAll' } });
  await flushAsyncWork();
  const played = new Set();
  for (let index = 0; index < songs.length; index++) {
    const current = app.savedState().current;
    assert.ok(current, `radio must not stop with only ${played.size} of ${songs.length} tracks played`);
    assert.equal(played.has(current.id), false, 'continue to unread tracks before repeating the initial page');
    played.add(current.id);
    await app.emit('music-player', 'ended');
    await flushAsyncWork();
    if (index === 59) {
      app = await createPlaybackApp(app.savedState(), options);
      await app.init();
      await app.emit('playbackPlayPause', 'click');
      await flushAsyncWork();
    }
  }
  assert.equal(played.size, songs.length);
});

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
    else if (i === 1) requests.at(-1).resolve({ ok: true, json: async () => ({ ok: true, data: { saved: false } }) });
    else requests.at(-1).resolve({ ok: false });
    await saving;
    assert.equal(notices.length, i === 0 ? 0 : 1);
  }
  assert.equal(notices[0].type, 'warning');
  const late = save();
  const lateRequest = requests.at(-1);
  const recovery = save();
  requests.at(-1).resolve({ ok: true, json: async () => ({ ok: true, data: { saved: true } }) });
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
    ], 0, 'radio', '电台', `${source}:radio`, 5);
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
    assert.equal(state.radioOffset, 5, 'failed requests must retry the same unread window');
  }
  const duplicate = refill();
  requests.at(-1).resolve({ ok: true, data: { tracks: [
    { id: 'qq:last', source: 'qq' }, { id: 'qq:current', source: 'qq' },
  ] } });
  await duplicate;
  assert.equal(notices.length, 1, 'a response containing only queued tracks does not announce recovery');
  assert.equal(state.radioOffset, 10, 'a duplicate-only response advances past the already read window');
  const recovery = refill();
  requests.at(-1).resolve({ ok: true, data: { tracks: [{ id: 'new', title: '新歌' }] } });
  await recovery;
  assert.equal(notices.length, 2);
  assert.equal(notices[1].type, 'success');
  assert.equal(state.radioOffset, 15);
  state.radioQueue.length = 0;
  const empty = refill();
  requests.at(-1).resolve({ ok: true, data: { tracks: [] } });
  await empty;
  assert.equal(notices.length, 3);
  assert.equal(state.radioOffset, 15, 'an empty response does not advance the unread window');
  const switched = refill();
  startRadio('netease');
  requests.at(-1).reject(new Error('late old provider failure'));
  await switched;
  assert.equal(notices.length, 3);
});

test('radio refill keeps its provider when another music tab is selected', async () => {
  const { state, refill, requests } = await createRadioFixture();
  state.selectedSource = 'netease';
  state.radioOffset = 7;
  const filling = refill();
  assert.equal(requests[0].body.platform, 'qq');
  assert.equal(requests[0].body.action, 'radio');
  const waitingAgain = refill();
  assert.equal(requests.length, 1, 'the active radio has only one refill in flight');
  const provider = new QQMusicProvider();
  const firstplays = [];
  provider.requestMusicu = async (body) => {
    firstplays.push(body.songlist.param.firstplay);
    return { songlist: { data: { tracks: Array.from({ length: 5 }, (_, index) => ({
      mid: `new-${index}`, title: `New song ${index}`, singer: [],
    })) } } };
  };
  const tracks = await provider.getRadioTracks(requests[0].body);
  requests[0].resolve({ ok: true, data: { tracks } });
  await Promise.all([filling, waitingAgain]);
  assert.deepEqual(firstplays, [0], 'a QQ refill continues the provider session');
  assert.deepEqual(Array.from(state.radioQueue, (track) => track.id), [
    'qq:last', 'qq:new-0', 'qq:new-1', 'qq:new-2', 'qq:new-3', 'qq:new-4',
  ], 'QQ returns new tracks without the NetEase page-prefix trimming');
});

test('NetEase radio resumes within a refill window and wraps the provider page limit', async () => {
  const { state, startRadio, refill, requests } = await createRadioFixture();
  startRadio('netease');
  state.radioOffset = 249;
  const failed = refill();
  assert.equal(requests[0].body.page, 50);
  requests[0].reject(new Error('offline'));
  await failed;
  const retry = refill();
  assert.equal(requests[1].body.page, 50, 'retry the partially read page after failure');
  requests[1].resolve({ ok: true, data: { tracks: Array.from({ length: 5 }, (_, index) => ({
    id: `netease:${245 + index}`, source: 'netease',
  })) } });
  await retry;
  assert.deepEqual(Array.from(state.radioQueue, (track) => track.id), ['netease:last', 'netease:249']);
  const next = refill();
  assert.equal(requests[2].body.page, 1, 'continue after the provider maximum instead of clamping to page 50');
  requests[2].resolve({ ok: true, data: { tracks: [{ id: 'netease:0', source: 'netease' }] } });
  await next;
  assert.deepEqual(Array.from(state.radioQueue, (track) => track.id), ['netease:last', 'netease:249', 'netease:0']);
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
    assert.equal(state.radioOffset, 5, 'an old response must not advance the new radio');
    assert.deepEqual(updates, [], 'the old response does not save or rerender the new radio');
    assert.deepEqual(notices, []);
    const waitingAgain = refill();
    assert.equal(requests.length, 2, 'completion of the old request cannot unlock the new refill');
    requests[1].resolve({ ok: true, data: { tracks: [{ id: `${source}:new-result`, source }] } });
    await Promise.all([newFilling, waitingAgain]);
    assert.deepEqual(Array.from(state.radioQueue, (track) => track.id), [`${source}:last`, `${source}:new-result`]);
    assert.equal(state.radioOffset, 10);
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
