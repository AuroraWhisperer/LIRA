// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { closestTarget, createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('clearing a partially published import preserves handled requests across restore', async (t) => {
  const waiting = [1, 2].map(id => ({ id, created_at: '2026-10-16T02:00:00Z', song_name: `request-${id}` }));
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const secondStarted = Promise.withResolvers();
  let matchCount = 0;
  let delaySecond = true;
  const services = {
    songQueue: { waiting },
    async matchTrack(input) {
      matchCount++;
      if (input.songName === 'request-2' && delaySecond) {
        secondStarted.resolve();
        await release.promise;
      }
      return { autoAccept: false, score: 60, track: track(input.songName, input.songName) };
    },
  };
  const app = await createPlaybackApp({ current: null, selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, services);
  await app.init();
  await flushAsyncWork();
  const importing = app.emit('playbackImportSongQueue', 'click');
  await secondStarted.promise;
  await app.emit('playbackClearQueue', 'click');
  const countAtClear = matchCount;
  assert.equal(app.element('playbackImportSongQueue').disabled, false);
  assert.equal(app.element('songQueueImportPlayback').disabled, false);
  assert.equal(app.savedState().pendingRequests.length, 0);
  assert.equal(app.savedState().importedSongRequestKeys.length, 1);
  delaySecond = false;
  release.resolve();
  await importing;
  assert.equal(matchCount, countAtClear);
  assert.equal(app.savedState().pendingRequests.length, 0);
  const restored = await createPlaybackApp(app.savedState(), services);
  await restored.init();
  await flushAsyncWork();
  await restored.emit('playbackImportSongQueue', 'click');
  assert.deepEqual(restored.savedState().pendingRequests.map(item => item.songName), ['request-2']);
});

test('cancelling queue clearing preserves music, pending matches and imported request history', async () => {
  const current = { ...track('current', '当前歌曲'), songRequestKey: 'handled' };
  const app = await createPlaybackApp({ current, normalQueue: [track('next', '下一首')],
    pendingRequests: [{ songName: '待确认', track: track('pending', '候选') }], importedSongRequestKeys: ['handled'],
    mode: 'sequence', volume: 0.75, selectedSource: 'qq', queueType: 'queue' }, { confirmationResult: false });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await app.emit('playbackClearQueue', 'click');
  assert.equal(app.element('music-player').paused, false);
  assert.equal(app.savedState().current.id, 'current');
  assert.equal(app.savedState().pendingRequests.length, 1);
  assert.deepEqual(app.savedState().importedSongRequestKeys, ['handled']);
  assert.equal(app.confirmations().length, 1);
});

test('clearing pending matches removes back history but keeps recent plays and handled request keys', async () => {
  const recent = track('recent', '最近播放');
  const app = await createPlaybackApp({ current: null, normalQueue: [],
    pendingRequests: [{ songName: '待确认', songRequestKey: 'pending', track: track('candidate', '候选') }],
    history: [recent], displayHistory: [recent], importedSongRequestKeys: ['pending'],
    mode: 'sequence', volume: 0.75, selectedSource: 'qq' });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackClearQueue', 'click');
  assert.equal(app.savedState().pendingRequests.length, 0);
  assert.equal(app.savedState().history.length, 0);
  assert.equal(app.savedState().displayHistory[0].id, 'recent');
  assert.deepEqual(app.savedState().importedSongRequestKeys, ['pending']);
  assert.equal(app.confirmations().length, 1);
  await app.emit('playbackClearQueue', 'click');
  assert.equal(app.confirmations().length, 1, 'recent plays and handled keys alone do not prompt destructive confirmation');
});

test('queue rendering follows in-place metadata and match corrections', async () => {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        innerHTML: '', textContent: '', contains: () => false, addEventListener() {},
        classList: { add() {}, remove() {} },
      });
      return elements.get(id);
    },
  };
  const { QueuePopup } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/ui/queue-popup.js'), { document });
  const popup = new QueuePopup();
  popup.init();
  popup.open();
  const local = track('local-track', '本地歌曲');
  const state = {
    current: local, currentOrigin: 'normal', queueType: 'queue', queueTitle: '播放队列', playlistIndex: -1,
    normalQueue: [local], normalQueueTracks: [], radioQueue: [], pendingRequests: [],
  };
  const list = document.getElementById('playbackQueueList');
  popup.render(state);
  local.artists.push('新增歌手');
  popup.render(state);
  assert.match(list.innerHTML, /新增歌手/);

  const pending = { songName: '观众请求', score: 60, reasons: ['待核对'], track: track('match', '候选歌曲') };
  state.pendingRequests.push(pending);
  popup.render(state);
  pending.track.title = '修正后的候选';
  popup.render(state);
  assert.match(list.innerHTML, /修正后的候选/);
  state.pendingRequests.splice(0, 1);
  popup.render(state);
  assert.doesNotMatch(list.innerHTML, /观众请求/);
});

for (const [queueType, mode] of [['queue', 'sequence'], ['playlist', 'shuffle'], ['radio', 'shuffle']]) {
  test(`confirming a request queues the next song without interrupting audio (${queueType}/${mode})`, async () => {
    const current = track('playing', '正在播放');
    const next = track('old-next', '原下一首');
    const request = { ...track('requested', '观众点歌'), songRequestKey: '["81","2026-10-08T09:00:00Z"]' };
    const app = await createPlaybackApp({
      current,
      currentOrigin: queueType === 'radio' ? 'radio' : 'normal',
      queueType,
      mode,
      volume: 0.75,
      selectedSource: 'qq',
      normalQueue: queueType === 'radio' ? [] : [next],
      radioQueue: queueType === 'radio' ? [next] : [],
      normalQueueTracks: queueType === 'playlist' ? [current, next] : [],
      playlistIndex: queueType === 'playlist' ? 0 : -1,
      shuffleOrder: [next.id],
      shuffleCursor: 0,
      pendingRequests: [{ id: 'pending:81:requested', songRequestKey: request.songRequestKey, track: request, requesterName: '观众甲' }],
    });
    await app.init();
    await flushAsyncWork();
    await app.emit('playbackPlayPause', 'click');
    await flushAsyncWork();
    app.element('music-player').currentTime = 37;
    const playCalls = app.audioPlayCalls();
    const audioSource = app.element('music-player').src;

    await app.emit('pendingConfirmAcceptBtn', 'click');
    await app.emit('pendingConfirmAcceptBtn', 'click');
    await flushAsyncWork();
    const saved = app.savedState();
    const queue = queueType === 'radio' ? saved.radioQueue : saved.normalQueue;
    assert.equal(saved.current.id, current.id);
    assert.equal(app.element('music-player').src, audioSource);
    assert.equal(app.element('music-player').currentTime, 37);
    assert.equal(app.audioPlayCalls(), playCalls);
    assert.equal(saved.pendingRequests.length, 0);
    assert.deepEqual(queue.map((item) => item.id), [request.id, next.id]);
    assert.equal(queue[0].requestedBy, '观众甲');
    assert.equal(queue[0].songRequestKey, request.songRequestKey);
    if (queueType === 'playlist') {
      assert.deepEqual(saved.normalQueueTracks.map((item) => item.id), [current.id, request.id, next.id]);
      assert.equal(saved.playlistIndex, 0);
    }

    await app.emit('playbackNext', 'click');
    await flushAsyncWork();
    assert.equal(app.savedState().current.id, request.id);
    assert.equal(app.audioPlayCalls(), playCalls + 1);
  });
}

test('confirming a request with no current song waits for the normal play control', async () => {
  const app = await createPlaybackApp({
    mode: 'sequence', volume: 0.75, selectedSource: 'qq',
    pendingRequests: [{ id: 'pending:1:requested', track: track('requested', '观众点歌') }],
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('pendingConfirmAcceptBtn', 'click');
  assert.equal(app.savedState().current, null);
  assert.equal(app.audioPlayCalls(), 0);
  assert.equal(app.savedState().normalQueue[0].id, 'requested');
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'requested');
});

test('repeated imports keep different requests of the same song and do not interrupt playback', async () => {
  let fetchCount = 0;
  let releaseQueue;
  const queueReady = new Promise((resolve) => { releaseQueue = resolve; });
  const items = [1, 2].map((id) => ({ id, created_at: '2026-10-08T09:00:00Z', song_name: '同一首歌', requester_name: `观众${id}` }));
  const options = {
    songQueue: async () => { fetchCount++; await queueReady; return { current: null, waiting: items }; },
  };
  const app = await createPlaybackApp({
    current: track('playing', '正在播放'), mode: 'sequence', volume: 0.75, selectedSource: 'qq',
  }, options);
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  const first = app.emit('playbackImportSongQueue', 'click');
  const duplicate = app.emit('songQueueImportPlayback', 'click');
  releaseQueue();
  await Promise.all([first, duplicate]);
  await app.emit('playbackImportSongQueue', 'click');
  const saved = app.savedState();
  assert.equal(fetchCount, 2, 'overlapping import clicks share the in-flight operation');
  assert.equal(saved.current.id, 'playing');
  assert.equal(app.audioPlayCalls(), 1);
  assert.equal(saved.normalQueue.length, 2);
  assert.equal(new Set(saved.normalQueue.map((item) => item.id)).size, 1);
  assert.equal(new Set(saved.normalQueue.map((item) => item.songRequestKey)).size, 2);
  assert.deepEqual(saved.normalQueue.map((item) => item.requestedBy), ['观众1', '观众2']);
  assert.equal(saved.importedSongRequestKeys.length, 2);
});

for (const action of ['ended', 'next', 'error']) {
  test(`repeat-one only repeats on natural completion (${action})`, async () => {
    const current = track('repeat-a', '循环歌曲');
    const next = track('repeat-b', '下一首');
    const app = await createPlaybackApp({
      current,
      currentOrigin: 'normal',
      normalQueue: [next],
      normalQueueTracks: [current, next],
      mode: 'repeat-one',
      volume: 0.75,
      selectedSource: 'qq',
      queueType: 'queue',
    });
    await app.init();
    await flushAsyncWork();
    await app.emit('playbackPlayPause', 'click');
    await flushAsyncWork();
    if (action === 'next') {
      await app.emit('playbackNext', 'click');
    } else {
      await app.emit('music-player', action);
      if (action === 'error') {
        await flushAsyncWork();
        await app.emit('music-player', 'error');
      }
    }
    await flushAsyncWork();
    assert.equal(app.savedState().current.id, action === 'ended' ? current.id : next.id);
    assert.deepEqual(
      app.savedState().normalQueue.map((item) => item.id),
      action === 'ended' ? [next.id] : [],
    );
  });
}

test('playlist playback keeps one queue and loops with directly played search tracks', async () => {
  const savedState = {
    current: track('playlist-1', '歌单第一首'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [track('playlist-2', '歌单第二首'), track('playlist-3', '歌单第三首')],
    normalQueueTracks: [
      track('playlist-1', '歌单第一首'),
      track('playlist-2', '歌单第二首'),
      track('playlist-3', '歌单第三首'),
    ],
    radioQueue: [track('radio-1', '不应显示的电台歌曲'), track('radio-2', '不应保留的电台歌曲')],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '歌单队列',
    playlistIndex: 0,
    volume: 0.75,
  };
  const app = await createPlaybackApp(savedState);

  await app.init();
  await flushAsyncWork();

  app.element('playbackSearchKeyword').value = '新点的歌';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', {
    target: closestTarget(
      {
        playbackSearchAction: 'play',
        playbackSearchIndex: '0',
      },
      'playback-search-action',
    ),
  });
  await flushAsyncWork();

  let persisted = app.savedState();
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.current.id, 'searched');
  assert.equal(persisted.playlistIndex, 1);
  assert.deepEqual(
    persisted.normalQueueTracks.map((item) => item.id),
    ['playlist-1', 'searched', 'playlist-2', 'playlist-3'],
  );
  assert.deepEqual(
    persisted.normalQueue.map((item) => item.id),
    ['playlist-2', 'playlist-3'],
  );
  assert.deepEqual(persisted.radioQueue, []);

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'playlist-2');

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'playlist-3');

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  persisted = app.savedState();
  assert.equal(persisted.current.id, 'playlist-1');
  assert.deepEqual(
    persisted.normalQueue.map((item) => item.id),
    ['searched', 'playlist-2', 'playlist-3'],
  );
  assert.equal(app.radioRefillRequests(), 0);
});

test('playing a wanted track from radio switches to a looping history queue', async () => {
  const currentRadioTrack = track('radio-current', '当前电台歌曲');
  const olderTrack = track('history-old', '更早播放的歌曲');
  const app = await createPlaybackApp({
    current: currentRadioTrack,
    currentOrigin: 'radio',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [track('radio-next', '不应继续的电台歌曲')],
    displayHistory: [currentRadioTrack, olderTrack],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'radio',
    queueTitle: '电台队列',
    volume: 0.75,
  });

  await app.init();
  await flushAsyncWork();

  app.element('playbackSearchKeyword').value = '新想听的歌';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', {
    target: closestTarget(
      {
        playbackSearchAction: 'play',
        playbackSearchIndex: '0',
      },
      'playback-search-action',
    ),
  });
  await flushAsyncWork();

  let persisted = app.savedState();
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.current.id, 'searched');
  assert.equal(persisted.playlistIndex, 0);
  assert.deepEqual(
    persisted.normalQueueTracks.map((item) => item.id),
    ['searched', 'radio-current', 'history-old'],
  );
  assert.deepEqual(
    persisted.normalQueue.map((item) => item.id),
    ['radio-current', 'history-old'],
  );
  assert.deepEqual(persisted.radioQueue, []);

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  persisted = app.savedState();
  assert.equal(persisted.current.id, 'radio-current');
  assert.equal(app.radioRefillRequests(), 0);
});

test('clicking a drawer track replaces the queue with its visible list and preserves button actions', async () => {
  const visibleTracks = [
    track('daily-1', '每日第一首'),
    track('daily-2', '每日第二首'),
    track('daily-3', '每日第三首'),
  ];
  const app = await createPlaybackApp(
    {
      current: track('old-current', '原队列歌曲'),
      currentOrigin: 'normal',
      requestedQueue: [track('old-requested', '原插队歌曲')],
      normalQueue: [track('old-next', '原下一首')],
      normalQueueTracks: [track('old-current', '原队列歌曲'), track('old-next', '原下一首')],
      radioQueue: [track('old-radio', '原电台歌曲')],
      mode: 'sequence',
      selectedSource: 'qq',
      queueType: 'playlist',
      queueTitle: '原播放队列',
      queueSourceKey: 'qq:liked',
      playlistIndex: 0,
      volume: 0.75,
    },
    {
      authState: { platform: 'qq', loggedIn: true },
      homeAction: 'daily',
      homeTracks: visibleTracks,
    },
  );

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackMenuIndex: '1' }, 'playback-home-track-menu-index'),
  });
  assert.equal(app.savedState().current.id, 'old-current', 'the menu button must not play its row');

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackRowIndex: '1' }, 'playback-home-track-row-index'),
  });
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'daily-2');
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.queueSourceKey, 'qq:daily:["daily-1","daily-2","daily-3"]');
  assert.equal(persisted.playlistIndex, 1);
  assert.deepEqual(
    persisted.normalQueueTracks.map((item) => item.id),
    ['daily-1', 'daily-2', 'daily-3'],
  );
  assert.deepEqual(
    persisted.normalQueue.map((item) => item.id),
    ['daily-3'],
  );
  assert.deepEqual(persisted.requestedQueue, []);
  assert.deepEqual(persisted.radioQueue, []);
});

test('clicking a track in the active playlist jumps without duplicating or replacing that queue', async () => {
  const likedTracks = [
    track('liked-1', '霓虹派对'),
    track('liked-2', '枪火'),
    track('liked-3', '贩卖日落'),
    track('liked-4', 'China-2'),
  ];
  const searchedTrack = track('searched-between', '搜索插入歌曲');
  const app = await createPlaybackApp(
    {
      current: likedTracks[3],
      currentOrigin: 'normal',
      requestedQueue: [],
      normalQueue: [],
      normalQueueTracks: [likedTracks[0], searchedTrack, likedTracks[1], likedTracks[2], likedTracks[3]],
      radioQueue: [],
      mode: 'sequence',
      selectedSource: 'qq',
      queueType: 'playlist',
      queueTitle: '我喜欢',
      queueSourceKey: 'qq:liked',
      playlistIndex: 4,
      volume: 0.75,
    },
    {
      authState: { platform: 'qq', loggedIn: true },
      homeAction: 'liked',
      homeTracks: likedTracks,
    },
  );

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();

  const clickFirstLikedTrack = () =>
    app.emit('playbackDrawerBody', 'click', {
      target: closestTarget(
        {
          playbackHomeTrackAction: 'play',
          playbackHomeTrackIndex: '0',
        },
        'playback-home-track-action',
      ),
    });
  await Promise.all([clickFirstLikedTrack(), clickFirstLikedTrack()]);
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'liked-1');
  assert.equal(persisted.playlistIndex, 0);
  assert.equal(persisted.queueSourceKey, 'qq:liked');
  assert.deepEqual(
    persisted.normalQueueTracks.map((item) => item.id),
    ['liked-1', 'searched-between', 'liked-2', 'liked-3', 'liked-4'],
  );
  assert.deepEqual(
    persisted.normalQueue.map((item) => item.id),
    ['searched-between', 'liked-2', 'liked-3', 'liked-4'],
  );
  assert.equal(app.audioPlayCalls(), 1);
});

test('a source drawer and restored shuffle history select the original occurrence after a duplicate insertion', async () => {
  const tracks = ['A', 'B', 'R', 'T'].map((id) => track(id, id));
  const app = await createPlaybackApp({ selectedSource: 'qq', mode: 'sequence', volume: 0.75,
    displayHistory: tracks }, { homeAction: 'recent' });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  await app.emit('playbackDrawerActions', 'click', { target: { id: 'playbackDrawerPlayAll' } });
  await flushAsyncWork();
  await app.emit('playbackDrawerBody', 'click', { target: closestTarget({
    playbackHomeTrackAction: 'requested', playbackHomeTrackIndex: '2',
  }, 'playback-home-track-action') });
  await app.emit('playbackDrawerBody', 'click', { target: closestTarget({
    playbackHomeTrackRowIndex: '2',
  }, 'playback-home-track-row-index') });
  await flushAsyncWork();
  assert.deepEqual(app.savedState().normalQueueTracks.map((item) => item.id), ['A', 'R', 'B', 'R', 'T']);
  assert.equal(app.savedState().playlistIndex, 3);
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'T');

  const restored = await createPlaybackApp({ ...app.savedState(), mode: 'shuffle' });
  await restored.init();
  await flushAsyncWork();
  await restored.emit('playbackPrev', 'click');
  await flushAsyncWork();
  assert.equal(restored.savedState().playlistIndex, 3);
  assert.deepEqual(restored.savedState().normalQueue.map((item) => item.id), ['T']);
});

test('reselecting a direct search play from recent history keeps imported songs and pending matches', async () => {
  const waiting = ['Q', 'P'].map((song_name, id) => ({ id: id + 1, song_name, created_at: '2026-11-01T00:00:00Z' }));
  const app = await createPlaybackApp({ displayHistory: ['A', 'B'].map(id => track(id, id)),
    selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
    homeAction: 'recent', songQueue: { waiting },
    matchTrack: async ({ songName }) => ({ track: track(songName, songName), autoAccept: songName === 'Q', score: songName === 'Q' ? 100 : 60 }),
  });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await app.emit('playbackDrawerActions', 'click', { target: { id: 'playbackDrawerPlayAll' } });
  await flushAsyncWork();
  await app.emit('playbackImportSongQueue', 'click');
  app.element('playbackSearchKeyword').value = 'S';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', { target: closestTarget({
    playbackSearchAction: 'play', playbackSearchIndex: '0',
  }, 'playback-search-action') });
  await flushAsyncWork();
  await app.emitHomeAction();
  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackRowIndex: '0' }, 'playback-home-track-row-index'),
  });
  await flushAsyncWork();
  await app.emit('playbackImportSongQueue', 'click');
  const saved = app.savedState();
  assert.equal(saved.normalQueueTracks[saved.playlistIndex].id, 'searched');
  assert.deepEqual(saved.normalQueue.map(item => item.id), ['Q', 'B']);
  assert.deepEqual(saved.pendingRequests.map(item => item.songName), ['P']);
});

test('recent replay in a normal queue preserves imported requests and their handled keys', async () => {
  const waiting = ['accepted', 'candidate'].map((song_name, i) => ({ id: i + 1, song_name }));
  const app = await createPlaybackApp({ selectedSource: 'qq', mode: 'sequence', volume: 0.75,
    displayHistory: [track('older', 'older')] }, {
    homeAction: 'recent', songQueue: { waiting },
    matchTrack: async ({ songName }) => ({ track: track(songName, songName), autoAccept: songName === 'accepted' }),
  });
  await app.init();
  await flushAsyncWork();
  app.element('playbackSearchKeyword').value = 'searched';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', { target: closestTarget({
    playbackSearchAction: 'play', playbackSearchIndex: '0',
  }, 'playback-search-action') });
  await flushAsyncWork();
  await app.emit('playbackImportSongQueue', 'click');
  const before = app.savedState();
  assert.equal(before.queueType, 'queue');
  assert.deepEqual(before.normalQueue.map(item => item.id), ['accepted']);
  assert.deepEqual(before.pendingRequests.map(item => item.songName), ['candidate']);
  assert.equal(before.importedSongRequestKeys.length, 2);
  const plays = app.audioPlayCalls();
  await app.emitHomeAction();
  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackRowIndex: '0' }, 'playback-home-track-row-index'),
  });
  await flushAsyncWork();
  await app.emit('playbackImportSongQueue', 'click');
  const after = app.savedState();
  assert.deepEqual(after.normalQueue, before.normalQueue);
  assert.deepEqual(after.pendingRequests, before.pendingRequests);
  assert.deepEqual(after.importedSongRequestKeys, before.importedSongRequestKeys);
  assert.equal(after.current.id, before.current.id);
  assert.equal(after.queueType, 'queue');
  assert.equal(app.audioPlayCalls(), plays + 1);

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackRowIndex: '1' }, 'playback-home-track-row-index'),
  });
  await flushAsyncWork();
  const switched = app.savedState();
  assert.equal(switched.current.id, 'older');
  assert.equal(switched.queueSourceKey, 'local:recent');
  assert.equal(switched.pendingRequests.length, 0);
});

test('an unavailable playlist jump preserves the current song and remaining queue', async () => {
  const tracks = ['first', 'next', 'unavailable', 'last'].map(id => track(id, id));
  const app = await createPlaybackApp({ current: tracks[0], currentOrigin: 'normal',
    normalQueueTracks: tracks, normalQueue: tracks.slice(1), playlistIndex: 0,
    queueType: 'playlist', mode: 'sequence', selectedSource: 'qq', volume: 0.75 }, {
    resolveStream: (_count, request) => request.track.id === 'unavailable'
      ? {} : { url: `https://example.test/${request.track.id}.mp3` },
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  const audioSource = app.element('music-player').src;
  await app.emit('playbackQueueList', 'click', {
    target: closestTarget({ playbackPlaylistJump: '2' }, 'data-playback-playlist-jump'),
  });
  await flushAsyncWork();
  const saved = app.savedState();
  assert.equal(saved.current.id, 'first');
  assert.equal(saved.playlistIndex, 0);
  assert.deepEqual(saved.normalQueue.map(item => item.id), ['next', 'unavailable', 'last']);
  assert.equal(app.element('music-player').src, audioSource);
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'next');
});

test('a restored history playlist can replay across tabs with its audience requests intact', async () => {
  const [a, b, q] = ['A', 'B', 'Q'].map(id => track(id, id));
  q.songRequestKey = 'accepted';
  const app = await createPlaybackApp({
    selectedSource: 'netease', mode: 'sequence', volume: 0.75, current: a, playlistIndex: 0, queueType: 'playlist',
    queueSourceKey: 'qq:recent', displayHistory: [a, b], normalQueueTracks: [a, q, b], normalQueue: [q, b],
    pendingRequests: [{ songName: 'P', songRequestKey: 'pending', track: b }], importedSongRequestKeys: ['accepted', 'pending'],
  }, { homeAction: 'recent' });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackRowIndex: '0' }, 'playback-home-track-row-index'),
  });
  await flushAsyncWork();
  const saved = app.savedState();
  assert.equal(app.element('music-player').dataset.trackId, 'A');
  assert.deepEqual(saved.normalQueue.map(row => row.id), ['Q', 'B']);
  assert.deepEqual(saved.pendingRequests.map(row => row.songName), ['P']);
});

test('a restored shuffled legacy daily keeps both audience requests when selecting a duplicate', async () => {
  const source = ['A', 'B', 'A', 'C', 'D'].map((id, i) => ({ ...track(id, id), playlistOccurrence: i === 2 ? 1 : 0 }));
  const q = { ...track('A', '观众点的 A'), songRequestKey: 'Q', requestedBy: '观众', playlistOccurrence: -1 };
  const shuffled = [source[3], q, source[2], source[4], source[0], source[1]];
  const initial = { selectedSource: 'qq', mode: 'shuffle', volume: 0.75, current: shuffled[0], currentOrigin: 'normal',
    queueType: 'playlist', queueSourceKey: 'qq:daily', playlistIndex: 0,
    normalQueueTracks: shuffled, normalQueue: [{ ...q, playNext: true }, ...shuffled.slice(2)],
    pendingRequests: [{ songName: 'P', songRequestKey: 'P', track: source[0] }], importedSongRequestKeys: ['Q', 'P'] };
  let visible = source;
  let streamAvailable = false;
  const app = await createPlaybackApp(initial, { homeAction: 'daily', authState: { platform: 'qq', loggedIn: true },
    loadHome: () => ({ tracks: visible }), resolveStream: () => ({ url: streamAvailable ? 'https://example.test/A.mp3' : '' }) });
  await app.init();
  await flushAsyncWork();
  const selectSecond = async () => {
    await app.emitHomeAction();
    await flushAsyncWork();
    await app.emit('playbackDrawerBody', 'click', {
      target: closestTarget({ playbackHomeTrackRowIndex: '2' }, 'playback-home-track-row-index'),
    });
    await flushAsyncWork();
    return app.savedState();
  };
  const failed = await selectSecond();
  assert.equal(failed.queueSourceKey, 'qq:daily');
  assert.equal(failed.playlistIndex, 0);
  assert.equal(failed.normalQueue[0].songRequestKey, 'Q');
  streamAvailable = true;
  const restored = await selectSecond();
  assert.deepEqual(restored.pendingRequests.map(item => item.songRequestKey), ['P']);
  assert.equal(restored.normalQueueTracks[restored.playlistIndex].playlistOccurrence, 1);
  assert.equal(restored.normalQueueTracks[0].id, 'C');
  assert.equal(restored.current.playlistOccurrence, 1);
  assert.equal(restored.normalQueue[0].songRequestKey, 'Q');
  assert.deepEqual(restored.importedSongRequestKeys, ['Q', 'P']);
  assert.equal(restored.queueSourceKey, 'qq:daily:["A","B","A","C","D"]');
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.songRequestKey, 'Q');

  visible = [source[1], source[0], source[2], source[3], source[4]];
  const changed = await selectSecond();
  assert.equal(changed.queueSourceKey, 'qq:daily:["B","A","A","C","D"]');
  assert.deepEqual(changed.normalQueueTracks.map(item => item.id), ['B', 'A', 'A', 'C', 'D']);
});

test('a legacy daily starts the visible batch when source songs or their counts differ', async () => {
  const old = ['D', 'A', 'B', 'A', 'C'].map(id => track(id, id));
  for (const ids of [['A', 'B', 'B', 'C', 'D'], ['A', 'B', 'A', 'C', 'E']]) {
    const app = await createPlaybackApp({ selectedSource: 'qq', mode: 'shuffle', volume: 0.75, current: old[0],
      queueType: 'playlist', queueSourceKey: 'qq:daily', playlistIndex: 0, normalQueueTracks: old, normalQueue: old.slice(1),
    }, { homeAction: 'daily', authState: { platform: 'qq', loggedIn: true }, homeTracks: ids.map(id => track(id, id)) });
    await app.init();
    await flushAsyncWork();
    await app.emitHomeAction();
    await flushAsyncWork();
    await app.emit('playbackDrawerBody', 'click', {
      target: closestTarget({ playbackHomeTrackRowIndex: '0' }, 'playback-home-track-row-index'),
    });
    await flushAsyncWork();
    assert.deepEqual(app.savedState().normalQueueTracks.map(item => item.id), ids);
    assert.equal(app.savedState().playlistIndex, 0);
  }
});

test('a shared daily row replaces the reordered batch and audience queue only after its stream resolves', async () => {
  let order = ['A', 'B', 'C'];
  let stream;
  const app = await createPlaybackApp({ selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
    homeAction: 'daily', authState: { platform: 'qq', loggedIn: true }, loadHome: () => ({ tracks: order.map(id => track(id, id)) }),
    songQueue: { waiting: [{ id: 1, song_name: 'Q' }, { id: 2, song_name: 'P' }] },
    matchTrack: async ({ songName }) => ({ track: track(songName, songName), autoAccept: songName === 'Q' }),
    resolveStream: () => stream?.promise || { url: 'https://example.test/a.mp3', expireAt: 1 },
  });
  await app.init();
  await flushAsyncWork();
  const playFirst = async () => {
    await app.emitHomeAction();
    await flushAsyncWork();
    await app.emit('playbackDrawerBody', 'click', {
      target: closestTarget({ playbackHomeTrackRowIndex: '0' }, 'playback-home-track-row-index'),
    });
    await flushAsyncWork();
  };
  await playFirst();
  await app.emit('playbackImportSongQueue', 'click');
  const audio = app.element('music-player');
  audio.currentTime = 12;
  await app.emit('music-player', 'timeupdate');
  const old = app.savedState();
  assert.deepEqual(old.normalQueue.map(t => t.id), ['Q', 'B', 'C']);
  assert.deepEqual(old.pendingRequests.map(p => p.songName), ['P']);
  const assertOldPlayback = () => {
    const saved = app.savedState();
    assert.equal(saved.queueSourceKey, old.queueSourceKey);
    assert.equal(saved.playlistIndex, old.playlistIndex);
    assert.equal(saved.current.id, 'A');
    assert.deepEqual(saved.normalQueue, old.normalQueue);
    assert.deepEqual(saved.pendingRequests, old.pendingRequests);
    assert.deepEqual(saved.importedSongRequestKeys, old.importedSongRequestKeys);
    assert.equal(audio.src, 'https://example.test/a.mp3');
    assert.equal(audio.paused, false);
    assert.equal(audio.currentTime, 12);
  };
  order = ['A', 'C', 'B'];
  stream = Promise.withResolvers();
  await playFirst();
  assertOldPlayback();
  stream.resolve({});
  await flushAsyncWork();
  assertOldPlayback();
  stream = null;
  await playFirst();
  assert.equal(app.savedState().pendingRequests.length, 0);
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.element('music-player').dataset.trackId, 'C');
});

test('daily drawer jumps retain mixed manual and audience insertions in playback order', async () => {
  const app = await createPlaybackApp({ selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
    homeAction: 'daily', homeTracks: ['A', 'B'].map(id => track(id, id)), authState: { platform: 'qq', loggedIn: true },
    songQueue: { waiting: [{ id: 1, song_name: 'Q' }] },
    matchTrack: async () => ({ track: track('Q', 'Q'), autoAccept: true, score: 100 }),
  });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  const clickRow = async (index, action) => {
    const target = action
      ? closestTarget({ playbackHomeTrackAction: action, playbackHomeTrackIndex: String(index) }, 'playback-home-track-action')
      : closestTarget({ playbackHomeTrackRowIndex: String(index) }, 'playback-home-track-row-index');
    await app.emit('playbackDrawerBody', 'click', { target });
    await flushAsyncWork();
  };
  const entry = item => [item.id, item.playlistOccurrence];
  const remaining = () => app.savedState().normalQueue.map(entry);
  await clickRow(0);
  await app.emit('playbackImportSongQueue', 'click');
  await flushAsyncWork();
  await clickRow(1, 'requested');
  const expected = [['B', -2], ['Q', -1], ['B', 0]];
  assert.deepEqual(remaining(), expected);
  await clickRow(0);
  assert.deepEqual(remaining(), expected);

  await clickRow(1, 'normal');
  await clickRow(0);
  const tail = ['B', -3];
  assert.deepEqual(remaining(), [...expected, tail]);
  await clickRow(1);
  assert.deepEqual(entry(app.savedState().current), ['B', 0]);
  const afterJump = [expected[0], expected[1], tail];
  assert.deepEqual(remaining(), afterJump);
  for (const next of afterJump) {
    await app.emit('playbackNext', 'click');
    await flushAsyncWork();
    assert.deepEqual(entry(app.savedState().current), next);
  }
  await clickRow(0);
  assert.deepEqual(remaining(), [['B', 0]]);
});

test('a shuffled daily jump carries an older unmarked manual copy ahead of its pending request', async () => {
  const { QueueManager } = await loadModuleExports(path.join(__dirname, '../../public/js/playback/queue/manager.js'));
  const a = { id: 'A', playlistOccurrence: 0 };
  const b = { id: 'B', playlistOccurrence: 0 };
  const c = { id: 'C', playlistOccurrence: 0 };
  const manual = { id: 'B', playlistOccurrence: -2 };
  const q = { id: 'Q', songRequestKey: 'Q', playlistOccurrence: -1 };
  const tail = { id: 'B', playlistOccurrence: -3 };
  const state = { current: a, queueType: 'playlist', mode: 'shuffle', playlistIndex: 0,
    normalQueueTracks: [a, manual, q, b, c, tail], normalQueue: [manual, { ...q, playNext: true }, b, c, tail] };
  const manager = new QueueManager({ state });
  manager.jumpToPlaylistTrack(3, 'qq:daily:["A","B","C"]');
  assert.deepEqual(Array.from(state.normalQueue, item => item.playlistOccurrence), [-2, -1, 0, -3]);
  assert.equal(manager.takeNext().track.playlistOccurrence, -2);
  assert.equal(manager.takeNext().track.songRequestKey, 'Q');
});

test('only the accepted playlist jump commits its cursor and remaining queue', async (t) => {
  const tracks = ['first', 'next', 'slow', 'last'].map(id => track(id, id));
  const delayed = Promise.withResolvers();
  t.after(() => delayed.resolve({ url: 'https://example.test/slow.mp3' }));
  const app = await createPlaybackApp({ current: tracks[0], currentOrigin: 'normal',
    normalQueueTracks: tracks, normalQueue: tracks.slice(1), playlistIndex: 0,
    queueType: 'playlist', mode: 'sequence', selectedSource: 'qq', volume: 0.75 }, {
    resolveStream: (_count, request) => {
      if (request.track.id !== 'slow') return { url: `https://example.test/${request.track.id}.mp3` };
      return delayed.promise;
    },
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackQueueList', 'click', {
    target: closestTarget({ playbackPlaylistJump: '2' }, 'data-playback-playlist-jump'),
  });
  await flushAsyncWork();
  assert.equal(app.resolveStreamRequestCount(), 1);
  assert.equal(app.savedState().playlistIndex, 0, 'a pending jump must not move the queue cursor');
  await app.emit('playbackQueueList', 'click', {
    target: closestTarget({ playbackPlaylistJump: '1' }, 'data-playback-playlist-jump'),
  });
  await flushAsyncWork();
  delayed.resolve({ url: 'https://example.test/slow.mp3' });
  await flushAsyncWork();
  const saved = app.savedState();
  assert.equal(saved.current.id, 'next');
  assert.equal(saved.playlistIndex, 1);
  assert.deepEqual(saved.normalQueue.map(item => item.id), ['slow', 'last']);
  assert.equal(app.audioPlayCalls(), 1);
});

test('a playlist jump keeps the selected duplicate entry when a request is inserted while resolving', async (t) => {
  const tracks = [track('first', '第一首'), track('repeated', '重复歌曲'),
    track('repeated', '重复歌曲'), track('last', '最后一首')];
  const delayed = Promise.withResolvers();
  t.after(() => delayed.resolve({ url: 'https://example.test/repeated.mp3' }));
  const app = await createPlaybackApp({ current: tracks[0], currentOrigin: 'normal',
    normalQueueTracks: tracks, normalQueue: tracks.slice(1), playlistIndex: 0,
    queueType: 'playlist', mode: 'sequence', selectedSource: 'qq', volume: 0.75,
    pendingRequests: [{ songName: '重复歌曲', songRequestKey: 'request-1',
      requesterName: '观众', track: track('repeated', '重复歌曲') }],
  }, {
    resolveStream: (_count, request) => request.track.id === 'repeated'
      ? delayed.promise : { url: `https://example.test/${request.track.id}.mp3` },
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackQueueList', 'click', {
    target: closestTarget({ playbackPlaylistJump: '2' }, 'data-playback-playlist-jump'),
  });
  await flushAsyncWork();
  assert.equal(app.resolveStreamRequestCount(), 1);
  await app.emit('pendingConfirmAcceptBtn', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().playlistIndex, 0);
  assert.equal(app.savedState().normalQueueTracks[1].songRequestKey, 'request-1');

  delayed.resolve({ url: 'https://example.test/repeated.mp3' });
  await flushAsyncWork();
  const saved = app.savedState();
  assert.equal(saved.current.id, 'repeated');
  assert.equal(saved.playlistIndex, 3);
  assert.deepEqual(saved.normalQueue.map(item => item.id), ['last']);
  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'last');
});

for (const mode of ['sequence', 'repeat-one', 'shuffle']) {
  test(`playlist previous wraps from the first track (${mode})`, async () => {
    const tracks = [track('first', '第一首'), track('last', '最后一首')];
    const app = await createPlaybackApp({ current: tracks[0], currentOrigin: 'normal',
      normalQueueTracks: tracks, normalQueue: [tracks[1]], playlistIndex: 0,
      queueType: 'playlist', mode, selectedSource: 'qq', volume: 0.75 });
    await app.init();
    await flushAsyncWork();
    app.element('music-player').currentTime = 11;
    await app.emit('playbackPrev', 'click');
    await flushAsyncWork();
    assert.equal(app.savedState().current.id, 'last');
    assert.equal(app.savedState().playlistIndex, 1);
    assert.deepEqual(app.savedState().normalQueue, []);
    if (mode === 'shuffle') return;
    await app.emit('playbackNext', 'click');
    await flushAsyncWork();
    assert.equal(app.savedState().current.id, 'first');
    assert.equal(app.savedState().playlistIndex, 0);
  });
}

test('playlist previous follows list order, aligns the cursor and restores the next track', async () => {
  const tracks = [track('first', '第一首'), track('second', '第二首'), track('third', '第三首')];
  const app = await createPlaybackApp({ current: tracks[1], currentOrigin: 'normal',
    normalQueueTracks: tracks, normalQueue: [tracks[2]], playlistIndex: 1,
    history: [track('unrelated', '其他歌单')], queueType: 'playlist', mode: 'sequence',
    selectedSource: 'qq', volume: 0.75 });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPrev', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'first');
  assert.equal(app.savedState().playlistIndex, 0);
  assert.deepEqual(app.savedState().normalQueue.map(item => item.id), ['second', 'third']);
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'second');
});

test('replaying a playlist aligns unnumbered history with its rebuilt entries', async () => {
  const tracks = ['X', 'A', 'B', 'T'].map(id => track(id, id));
  const app = await createPlaybackApp({ current: tracks[2], history: tracks.slice(0, 2),
    normalQueueTracks: tracks, normalQueue: tracks.slice(3), playlistIndex: 2,
    queueType: 'playlist', queueSourceKey: 'qq:liked', mode: 'sequence', selectedSource: 'qq', volume: 0.75 },
  { homeAction: 'liked', homeTracks: tracks, authState: { platform: 'qq', loggedIn: true } });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  await app.emit('playbackDrawerActions', 'click', { target: { id: 'playbackDrawerPlayAll' } });
  await flushAsyncWork();
  await app.emit('playbackModeBtn', 'click');
  await app.emit('playbackPrev', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'A');
  assert.equal(app.savedState().playlistIndex, 1);
  await app.emit('playbackModeBtn', 'click');
  await app.emit('playbackModeBtn', 'click');
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'B');
});

for (const unavailable of [false, true]) {
  test(`shuffle previous follows listening history and only commits an available track (${unavailable})`, async () => {
    const tracks = [track('first', '第一首'), track('second', '第二首'), track('third', '第三首')];
    const app = await createPlaybackApp({ current: tracks[1], currentOrigin: 'normal',
      normalQueueTracks: tracks, normalQueue: [], playlistIndex: 1, history: [tracks[0], tracks[2]],
      queueType: 'playlist', mode: 'shuffle', selectedSource: 'qq', volume: 0.75 },
    { resolveStream: () => unavailable ? {} : { url: 'https://example.test/audio.mp3' } });
    await app.init();
    await flushAsyncWork();
    await app.emit('playbackPrev', 'click');
    await flushAsyncWork();
    assert.equal(app.savedState().current.id, unavailable ? 'second' : 'third');
    assert.equal(app.savedState().playlistIndex, unavailable ? 1 : 2);
    assert.deepEqual(app.savedState().history.map(item => item.id), unavailable ? ['first', 'third'] : ['first']);
  });
}

test('single-track playlist previous replays the same track', async () => {
  const current = track('only', '唯一一首');
  const app = await createPlaybackApp({ current, currentOrigin: 'normal', normalQueueTracks: [current],
    normalQueue: [], playlistIndex: 0, queueType: 'playlist', mode: 'sequence', selectedSource: 'qq', volume: 0.75 });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPrev', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'only');
  assert.equal(app.savedState().playlistIndex, 0);
  assert.equal(app.audioPlayCalls(), 1);
});

test('previous playback returns to the prior request of the same song without recording retries', async () => {
  const first = { ...track('same-song', 'Same song'), songRequestKey: 'request-1' };
  const second = { ...first, songRequestKey: 'request-2' };
  const app = await createPlaybackApp({
    current: first,
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [second],
    normalQueueTracks: [],
    radioQueue: [],
    history: [track('older', 'Older')],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75,
  });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.songRequestKey, second.songRequestKey);
  assert.equal(app.savedState().history.at(-1).songRequestKey, first.songRequestKey);

  await app.emit('music-player', 'error');
  await flushAsyncWork();
  assert.equal(app.savedState().history.length, 2);
  await app.emit('playbackPrev', 'click');
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.songRequestKey, first.songRequestKey);
  assert.deepEqual(
    persisted.history.map((item) => item.id),
    ['older'],
  );
});

test('exhausting the stream retry limit advances only while playback is requested', async () => {
  const app = await createPlaybackApp({
    current: track('current', 'Current'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [track('next', 'Next')],
    normalQueueTracks: [],
    radioQueue: [],
    history: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75,
  });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');

  await assert.doesNotReject(app.emit('music-player', 'error'));
  await flushAsyncWork();

  assert.equal(app.savedState().current.id, 'current');
  assert.equal(app.resolveStreamRequestCount(), 2);
  assert.deepEqual(app.errors(), []);

  await app.emit('playbackPlayPause', 'click');
  await app.emit('music-player', 'error');
  assert.equal(app.audioPlayCalls(), 2);
  assert.equal(app.element('music-player').paused, true);
  assert.equal(app.savedState().current.id, 'current');

  await app.emit('playbackPlayPause', 'click');
  await assert.doesNotReject(app.emit('music-player', 'error'));
  await flushAsyncWork();

  assert.equal(app.savedState().current.id, 'next');
  assert.equal(app.audioPlayCalls(), 4);
  assert.equal(app.resolveStreamRequestCount(), 3);
  assert.deepEqual(app.errors(), []);
});

test('clearing playback queue invalidates a pending next-track stream', async () => {
  let resolveNextStream;
  const nextStream = new Promise((resolve) => {
    resolveNextStream = resolve;
  });
  const app = await createPlaybackApp(
    {
      current: track('current', '当前歌曲'),
      currentOrigin: 'normal',
      requestedQueue: [],
      normalQueue: [track('next', '下一首')],
      normalQueueTracks: [],
      radioQueue: [],
      history: [],
      displayHistory: [],
      mode: 'sequence',
      selectedSource: 'qq',
      queueType: 'queue',
      queueTitle: '播放队列',
      volume: 0.75,
    },
    {
      async resolveStream(requestCount) {
        if (requestCount === 2) return nextStream;
        return { url: 'https://example.test/current.mp3' };
      },
    },
  );

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  await app.emit('music-player', 'ended');
  await flushAsyncWork();

  assert.equal(app.resolveStreamRequestCount(), 2);

  await app.emit('playbackClearQueue', 'click');
  resolveNextStream({ url: 'https://example.test/next.mp3' });
  await flushAsyncWork();

  assert.equal(app.savedState().current, null);
  assert.equal(app.element('music-player').src, '');
  assert.equal(app.element('music-player').paused, true);
  assert.equal(app.audioPlayCalls(), 1);
});
