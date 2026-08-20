// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  closestTarget,
  createPlaybackApp,
  flushAsyncWork,
  track
} = require('./helpers/playback-app');

test('empty playback uses the latest authenticated provider state', async () => {
  const app = await createPlaybackApp({
    current: null,
    currentOrigin: '',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    history: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75
  }, {
    authState: { platform: 'qq', loggedIn: true }
  });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');

  const prompt = app.element('toast').prepended.at(0);
  assert.match(prompt.innerHTML, /播放队列为空/);
  assert.match(prompt.innerHTML, /搜索QQ音乐歌曲并添加到播放队列/);
});

test('pagehide beacon includes the injected API token', async () => {
  const app = await createPlaybackApp({
    current: track('current', 'Current'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75
  }, { apiToken: 'token with & symbols' });

  await app.init();
  await flushAsyncWork();
  await app.emitWindow('pagehide');

  assert.equal(
    app.beaconUrls().at(-1),
    '/api/playback/queue-state?token=token%20with%20%26%20symbols'
  );
});

test('playback persistence retains the numeric QQ song ID', async () => {
  const current = {
    ...track('000w1gfs48CBnw', '해볼래 (试试看)'),
    sourceSongId: 107402287,
    sourceSongType: 1
  };
  const app = await createPlaybackApp({
    current,
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [current],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '我喜欢',
    playlistIndex: 0,
    volume: 0.75
  });

  await app.init();
  await flushAsyncWork();
  await app.emitWindow('pagehide');

  const persisted = app.ipcSavedState();
  assert.equal(persisted.current.sourceSongId, 107402287);
  assert.equal(persisted.current.sourceSongType, 1);
  assert.equal(persisted.normalQueueTracks[0].sourceSongId, 107402287);
  assert.equal(persisted.normalQueueTracks[0].sourceSongType, 1);
});

test('cold start restores the server queue and playback progress without local storage', async () => {
  const savedState = {
    current: track('restored-current', '恢复的歌曲'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [track('restored-next', '恢复的下一首')],
    normalQueueTracks: [
      track('restored-current', '恢复的歌曲'),
      track('restored-next', '恢复的下一首')
    ],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '恢复的歌单',
    playlistIndex: 0,
    currentTime: 42,
    volume: 0.75
  };
  const app = await createPlaybackApp(savedState, { localState: null });

  await app.init();
  await flushAsyncWork();

  assert.equal(app.element('queuePopupTitle').textContent, '恢复的歌单');
  assert.equal(app.element('queuePopupSize').textContent, '2 首');
  assert.equal(app.element('playbackCurrentTime').textContent, '00:42');
  assert.match(app.element('playbackQueueList').innerHTML, /恢复的下一首/);
});

test('desktop shutdown awaits the pending playback state IPC save', async () => {
  const savedState = {
    current: track('shutdown-current', '退出前歌曲'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [track('shutdown-current', '退出前歌曲')],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '退出前队列',
    playlistIndex: 0,
    currentTime: 37,
    volume: 0.75
  };
  const app = await createPlaybackApp(savedState, { localState: null });

  await app.init();
  await flushAsyncWork();
  assert.equal(app.hasPrepareShutdownListener(), true);
  await app.emitPrepareShutdown();

  assert.equal(app.ipcSavedState().currentTime, 37);
  assert.equal(app.shutdownAcknowledged(), true);
});

test('pagehide preserves personal playlist caches for the next desktop start', async () => {
  const sharedStorage = new Map();
  const app = await createPlaybackApp({
    current: null,
    currentOrigin: '',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75
  }, {
    storage: sharedStorage,
    authState: { platform: 'qq', loggedIn: true },
    homeAction: 'liked',
    homeTracks: [track('cached-liked', '缓存歌曲')]
  });

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  assert.equal(app.hasStorageKey('playbackCache:v2:qq:liked'), true);

  await app.emitWindow('pagehide');

  assert.equal(app.hasStorageKey('playbackCache:v2:qq:liked'), true);
});
