// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');

test('a restored track accepts a seek before metadata and saves the latest position across reopen', async () => {
  const state = { current: track('song', 'Song'), currentTime: 37, selectedSource: 'qq', mode: 'sequence', volume: 0.75 };
  const open = async (snapshot, options) => {
    const app = await createPlaybackApp(snapshot, options);
    const audio = app.element('music-player');
    Object.assign(audio, { readyState: 0, duration: NaN });
    await app.init();
    await flushAsyncWork();
    const slider = app.element('playbackSeek');
    return { app, audio, slider, seek(value) {
      slider.value = String(value);
      return app.emit('playbackSeek', 'input', { target: slider });
    } };
  };
  const first = await open(state);
  assert.deepEqual([first.slider.max, first.slider.value], ['180', '37']);
  await first.seek(250);
  assert.equal(first.app.savedState().currentTime, 180);
  await first.seek(81);
  assert.equal(first.app.element('playbackCurrentTime').textContent, '01:21');
  const saved = first.app.savedState();
  assert.equal(saved.currentTime, 81);
  assert.equal(first.app.audioPlayCalls(), 0);
  const stream = Promise.withResolvers();
  const { app, audio, slider, seek } = await open(saved, { resolveStream: () => stream.promise });
  assert.equal(slider.value, '81');
  const playing = app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  await seek(88);
  stream.resolve({ url: 'https://example.test/song.mp3' });
  await playing;
  assert.equal(app.savedState().currentTime, 88);
  await seek(95);
  Object.assign(audio, { readyState: 1, duration: 94 });
  await app.emit('music-player', 'loadedmetadata');
  assert.equal(audio.currentTime, 93, 'pending seek uses the actual media duration at startup');
  await seek(42);
  assert.equal(audio.currentTime, 42);
  assert.equal(app.savedState().currentTime, 42);
  assert.equal(app.audioPlayCalls(), 1);
});

test('previous before first playback clears a restored position without history', async () => {
  const app = await createPlaybackApp({ current: track('song', 'Song'), currentTime: 92,
    selectedSource: 'qq', mode: 'sequence', volume: 0.75 });
  const audio = app.element('music-player');
  Object.assign(audio, { readyState: 0, duration: NaN });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPrev', 'click');
  assert.equal(app.element('playbackSeek').value, '0');
  assert.equal(app.savedState().currentTime, 0);
  assert.equal(app.audioPlayCalls(), 0);
  await app.emit('playbackPlayPause', 'click');
  Object.assign(audio, { readyState: 1, duration: 180 });
  await app.emit('music-player', 'loadedmetadata');
  assert.equal(audio.currentTime, 0);
});

for (const { before, after, position, expected, legacy = false } of [
  { before: 30000, after: 0, position: 5, expected: 35 },
  { before: 0, after: 30000, position: 35, expected: 5 },
  { before: 30000, after: 45000, position: 20, expected: 5 },
  { before: 30000, after: 30000, position: 5, expected: 5 },
  { before: 0, after: 0, position: 35, expected: 35 },
  { before: 30000, after: 30000, position: 5, expected: 5, legacy: true },
]) {
  test(`restart preserves song position when excerpt changes from ${before} to ${after}${legacy ? ' (legacy snapshot)' : ''}`, async () => {
    const open = async (snapshot, startMs) => {
      const app = await createPlaybackApp(snapshot, { resolveStream: () => ({
        url: 'https://example.test/audio.mp3', trial: startMs > 0, trialStartMs: startMs,
      }) });
      const audio = app.element('music-player');
      Object.assign(audio, { readyState: 0, duration: NaN });
      await app.init();
      await flushAsyncWork();
      await app.emit('playbackPlayPause', 'click');
      Object.assign(audio, { readyState: 1, duration: startMs ? 30 : 180 });
      await app.emit('music-player', 'loadedmetadata');
      return { app, audio };
    };
    const first = await open({ current: { ...track('song', 'Song'), source: 'netease' },
      selectedSource: 'netease', mode: 'sequence', volume: 0.75 }, before);
    first.audio.currentTime = position;
    await first.app.emitPrepareShutdown();
    let saved = first.app.ipcSavedState();
    if (legacy) {
      delete saved.current.playbackTrial;
      delete saved.current.playbackTrialStartMs;
      const unopened = await createPlaybackApp(saved);
      await unopened.init();
      await flushAsyncWork();
      await unopened.emitPrepareShutdown();
      saved = unopened.ipcSavedState();
    }
    const second = await open(saved, after);
    assert.equal(second.audio.currentTime, expected);
    assert.equal(second.audio.currentTime + after / 1000, position + before / 1000);
  });
}

for (const autoAccept of [true, false]) {
  test(`clearing during an ${autoAccept ? 'accepted' : 'pending'} import prevents stale queue writes`, async () => {
    const match = Promise.withResolvers();
    const app = await createPlaybackApp(null, {
      songQueue: { waiting: [{ id: 1, created_at: '2026-10-12T00:00:00Z', song_name: '歌曲' }] },
      matchTrack: () => match.promise,
    });
    await app.init();
    await flushAsyncWork();
    const importing = app.emit('playbackImportSongQueue', 'click');
    await flushAsyncWork();
    await app.emit('playbackClearQueue', 'click');
    match.resolve({ autoAccept, score: autoAccept ? 100 : 50, track: track('matched', '歌曲') });
    await importing;
    const saved = app.savedState();
    assert.equal(saved.normalQueue.length, 0);
    assert.equal(saved.pendingRequests.length, 0);
    assert.equal(saved.importedSongRequestKeys.length, 0);
    await app.emit('playbackImportSongQueue', 'click');
    assert.equal(app.savedState()[autoAccept ? 'normalQueue' : 'pendingRequests'].length, 1);
    assert.equal(app.savedState().importedSongRequestKeys.length, 1);
  });
}

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
  const first = await createPlaybackApp(null, { localState: saved, storage });
  await first.init();
  await flushAsyncWork();
  const migrated = JSON.parse(storage.get('playbackState:v2'));
  assert.deepEqual(migrated.importedSongRequestKeys, saved.importedSongRequestKeys);
  assert.equal(migrated.pendingRequests.length, 1);
  const restored = await createPlaybackApp(null, { localState: null, storage });
  await restored.init();
  await flushAsyncWork();
  await restored.emitWindow('pagehide');
  assert.deepEqual(restored.ipcSavedState().importedSongRequestKeys, saved.importedSongRequestKeys);
  assert.equal(restored.ipcSavedState().pendingRequests.length, 1);
  assert.equal(restored.ipcSavedState().current.songRequestKey, key);
  assert.equal(restored.ipcSavedState().current.requestedBy, '观众甲');
});

for (const [mode, source] of [['repeat-one', 'server'], ['single', 'v2'], ['single', 'v1']]) {
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
    const app = await createPlaybackApp(source === 'server' ? saved : null, {
      localState: source === 'v1' ? saved : null,
      storage,
    });

    await app.init();
    await flushAsyncWork();
    await app.emitWindow('pagehide');
    const persisted = app.ipcSavedState();
    assert.equal(persisted.mode, 'repeat-one');
    assert.equal(persisted.currentTime, 42);
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
  await restored.emitWindow('pagehide');
  assert.equal(restored.ipcSavedState().mode, 'repeat-one');
  assert.deepEqual(restored.ipcSavedState().normalQueue.map((item) => item.id), [next.id]);
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
  await app.emitWindow('pagehide');

  const restored = app.ipcSavedState();
  assert.equal(restored.current.id, 'restored-current');
  assert.equal(restored.currentTime, 42);
  assert.deepEqual(restored.normalQueue.map((item) => item.id), ['restored-next']);
  assert.equal(restored.queueTitle, '恢复的歌单');
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
  assert.equal(app.hasStorageKey('playbackCache:v2:qq:liked:201'), true);

  await app.emitWindow('pagehide');

  assert.equal(app.hasStorageKey('playbackCache:v2:qq:liked:201'), true);
});
