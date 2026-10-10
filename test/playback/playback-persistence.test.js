// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { closestTarget, createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');

test('pending-only imports and handled request IDs survive restart and confirmation', async () => {
  const item = { id: 8, created_at: '2026-10-08T09:00:00Z', song_name: '需要确认', requester_name: '观众甲' };
  let matches = 0;
  const options = {
    localState: null,
    songQueue: { current: null, waiting: [item] },
    matchTrack: () => { matches++; return { autoAccept: false, score: 60, track: track('pending-song', '需要确认') }; },
  };
  const app = await createPlaybackApp({ mode: 'sequence', volume: 0.75, selectedSource: 'qq' }, options);
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackImportSongQueue', 'click');
  await app.emitPrepareShutdown();
  const saved = app.ipcSavedState();
  assert.equal(saved.current, null);
  assert.equal(saved.normalQueue.length, 0);
  assert.equal(saved.pendingRequests.length, 1);
  assert.equal(saved.importedSongRequestKeys.length, 1);
  assert.equal(saved.pendingRequests[0].songRequestKey, JSON.stringify(['8', item.created_at]));

  const restored = await createPlaybackApp(saved, options);
  await restored.init();
  await flushAsyncWork();
  const matchesBefore = matches;
  await restored.emit('playbackImportSongQueue', 'click');
  assert.equal(matches, matchesBefore);
  assert.equal(restored.savedState().pendingRequests.length, 1);
  await restored.emit('pendingConfirmAcceptBtn', 'click');
  await restored.emit('playbackImportSongQueue', 'click');
  const confirmed = restored.savedState();
  assert.equal(confirmed.normalQueue.length, 1);
  assert.equal(confirmed.normalQueue[0].songRequestKey, saved.pendingRequests[0].songRequestKey);
  assert.equal(confirmed.normalQueue[0].requestedBy, '观众甲');
  assert.equal(confirmed.normalQueue[0].playNext, true);
  assert.equal(confirmed.pendingRequests.length, 0);
  assert.equal(matches, matchesBefore);

  const ready = await createPlaybackApp({ ...confirmed, mode: 'shuffle' }, options);
  await ready.init();
  await flushAsyncWork();
  await ready.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  assert.equal(ready.savedState().current.songRequestKey, saved.pendingRequests[0].songRequestKey);
  assert.equal(ready.savedState().current.playNext, false, 'priority is consumed when the queued song starts');

  await restored.emit('playbackClearQueue', 'click');
  const cleared = await createPlaybackApp(restored.savedState(), options);
  await cleared.init();
  await flushAsyncWork();
  await cleared.emit('playbackImportSongQueue', 'click');
  assert.equal(cleared.savedState().normalQueue.length, 0);
  assert.equal(cleared.savedState().pendingRequests.length, 0);
  assert.equal(matches, matchesBefore, 'explicit playback clearing does not reimport the still-active source request');
});

test('local fallback preserves imported request history and pending entries during v1 migration', async () => {
  const key = '["15","2026-10-08T09:00:00Z"]';
  const saved = {
    current: { ...track('current', '正在播放'), songRequestKey: key, requestedBy: '观众甲' },
    pendingRequests: [{ id: 'pending:16:next', songRequestKey: '["16","2026-10-08T09:01:00Z"]', track: track('next', '待确认') }],
    importedSongRequestKeys: [key, '["16","2026-10-08T09:01:00Z"]'],
    mode: 'sequence', volume: 0.75, selectedSource: 'qq',
  };
  const storage = new Map();
  const first = await createPlaybackApp(saved, { serverState: {}, storage });
  await first.init();
  await flushAsyncWork();
  const migrated = JSON.parse(storage.get('playbackState:v2'));
  assert.deepEqual(migrated.importedSongRequestKeys, saved.importedSongRequestKeys);
  assert.equal(migrated.pendingRequests.length, 1);
  const restored = await createPlaybackApp({}, { serverState: {}, localState: null, storage });
  await restored.init();
  await flushAsyncWork();
  await restored.emitWindow('pagehide');
  assert.deepEqual(restored.ipcSavedState().importedSongRequestKeys, saved.importedSongRequestKeys);
  assert.equal(restored.ipcSavedState().pendingRequests.length, 1);
  assert.equal(restored.ipcSavedState().current.songRequestKey, key);
  assert.equal(restored.ipcSavedState().current.requestedBy, '观众甲');
});

for (const mode of ['repeat-one', 'single']) {
  for (const source of ['server', 'v2', 'v1']) {
    test(`single-track repeat restores its queue and position from ${source} (${mode})`, async () => {
      const current = track('repeat-current', '循环歌曲');
      const next = track('repeat-next', '下一首');
      const saved = {
        current,
        currentOrigin: 'normal',
        normalQueue: [next],
        normalQueueTracks: [current, next],
        mode,
        volume: 0.75,
        selectedSource: 'qq',
        queueType: 'playlist',
        queueTitle: '循环歌单',
        playlistIndex: 0,
        currentTime: 42,
      };
      const storage = new Map();
      if (source === 'v2') storage.set('playbackState:v2', JSON.stringify(saved));
      const app = await createPlaybackApp(saved, {
        serverState: source === 'server' ? saved : {},
        localState: source === 'v1' ? saved : null,
        storage,
      });

      await app.init();
      await flushAsyncWork();
      assert.equal(app.element('playbackModeLabel').textContent, '单曲');
      assert.equal(app.element('playbackTrackTitle').textContent, current.title);
      assert.equal(app.element('playbackCurrentTime').textContent, '00:42');
      await app.emit('playbackQueueBtn', 'click');
      assert.match(app.element('playbackQueueList').innerHTML, /下一首/);
      await app.emitWindow('pagehide');
      const persisted = app.ipcSavedState();
      assert.equal(persisted.mode, 'repeat-one');
      assert.equal(persisted.current.id, current.id);
      assert.deepEqual(
        persisted.normalQueue.map((item) => item.id),
        [next.id],
      );

      await app.emit('playbackPlayPause', 'click');
      await flushAsyncWork();
      await app.emit('music-player', 'ended');
      await flushAsyncWork();
      assert.equal(app.element('music-player').dataset.trackId, current.id);
      assert.deepEqual(
        app.savedState().normalQueue.map((item) => item.id),
        [next.id],
      );
    });
  }
}

test('the single-track repeat mode selected in the UI survives a server snapshot round trip', async () => {
  const current = track('repeat-ui', '界面选择的循环歌曲');
  const next = track('repeat-ui-next', '界面选择的下一首');
  const app = await createPlaybackApp({
    current,
    normalQueue: [next],
    mode: 'sequence',
    volume: 0.75,
    selectedSource: 'qq',
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackModeBtn', 'click');
  await app.emit('playbackModeBtn', 'click');
  await app.emitWindow('pagehide');
  const saved = app.ipcSavedState();
  assert.equal(saved.mode, 'repeat-one');

  const restored = await createPlaybackApp(saved, { localState: null });
  await restored.init();
  await flushAsyncWork();
  assert.equal(restored.element('playbackModeLabel').textContent, '单曲');
  assert.equal(restored.element('playbackTrackTitle').textContent, current.title);
  await restored.emit('playbackQueueBtn', 'click');
  assert.match(restored.element('playbackQueueList').innerHTML, /界面选择的下一首/);
});

test('empty playback uses the latest authenticated provider state', async () => {
  const app = await createPlaybackApp(
    {
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
      volume: 0.75,
    },
    {
      authState: { platform: 'qq', loggedIn: true },
    },
  );

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');

  const prompt = app.element('toast').prepended.at(0);
  assert.match(prompt.children[0].textContent, /播放队列为空/);
  assert.match(prompt.children[0].textContent, /搜索QQ音乐歌曲并添加到播放队列/);
});

test('pagehide beacon includes the injected API token', async () => {
  const app = await createPlaybackApp(
    {
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
      volume: 0.75,
    },
    { apiToken: 'token with & symbols' },
  );

  await app.init();
  await flushAsyncWork();
  await app.emitWindow('pagehide');

  assert.equal(app.beaconUrls().at(-1), '/api/playback/queue-state?token=token%20with%20%26%20symbols');
});

test('playback persistence retains the numeric QQ song ID', async () => {
  const current = {
    ...track('000w1gfs48CBnw', '해볼래 (试试看)'),
    sourceSongId: 107402287,
    sourceSongType: 1,
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
    volume: 0.75,
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
    normalQueueTracks: [track('restored-current', '恢复的歌曲'), track('restored-next', '恢复的下一首')],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '恢复的歌单',
    playlistIndex: 0,
    currentTime: 42,
    volume: 0.75,
  };
  const app = await createPlaybackApp(savedState, { localState: null });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackQueueBtn', 'click');

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
    volume: 0.75,
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
  const app = await createPlaybackApp(
    {
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
      volume: 0.75,
    },
    {
      storage: sharedStorage,
      authState: { platform: 'qq', loggedIn: true },
      homeAction: 'liked',
      homeTracks: [track('cached-liked', '缓存歌曲')],
    },
  );

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  assert.equal(app.hasStorageKey('playbackCache:v2:qq:liked'), true);

  await app.emitWindow('pagehide');

  assert.equal(app.hasStorageKey('playbackCache:v2:qq:liked'), true);
});
