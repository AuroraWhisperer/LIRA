// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { closestTarget, createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('queue rendering follows in-place metadata, match corrections and playlist cursor changes', async () => {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        innerHTML: '', textContent: '', contains: () => false,
        classList: { add() {}, remove() {} },
      });
      return elements.get(id);
    },
  };
  const { QueuePopup } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/ui/queue-popup.js'), { document });
  const popup = new QueuePopup();
  popup.init();
  popup.open();
  const local = { ...track('local-track', '本地歌曲'), source: 'local', fileMissing: true };
  const state = {
    current: local, currentOrigin: 'normal', queueType: 'queue', queueTitle: '播放队列', playlistIndex: -1,
    normalQueue: [local], normalQueueTracks: [], radioQueue: [], pendingRequests: [],
  };
  const list = document.getElementById('playbackQueueList');
  popup.render(state);
  assert.match(list.innerHTML, /文件已移动，请重新选择/);
  assert.match(list.innerHTML, /playback-queue-row active/);

  local.objectUrl = 'local-media://synthetic-track';
  local.fileMissing = false;
  local.artists.push('新增歌手');
  local.durationMs = 62000;
  popup.render(state);
  assert.doesNotMatch(list.innerHTML, /需重新选择文件|文件已移动/);
  assert.match(list.innerHTML, /新增歌手[\s\S]*01:02/);

  const pending = { songName: '观众请求', score: 60, reasons: ['待核对'], track: track('match', '候选歌曲') };
  state.pendingRequests.push(pending);
  popup.render(state);
  assert.match(list.innerHTML, /60 分 · 待核对/);
  pending.track.title = '修正后的候选';
  pending.score = 90;
  pending.reasons.splice(0, 1, '歌手匹配');
  popup.render(state);
  assert.match(list.innerHTML, /修正后的候选[\s\S]*90 分 · 歌手匹配/);
  state.pendingRequests.splice(0, 1);
  state.current = { ...local, songRequestKey: 'another-request' };
  popup.render(state);
  assert.doesNotMatch(list.innerHTML, /playback-queue-row active|观众请求/);

  state.queueType = 'playlist';
  state.queueTitle = '本地歌单';
  state.normalQueueTracks.push(local, track('second', '第二首'));
  state.playlistIndex = 0;
  popup.render(state);
  assert.match(list.innerHTML, /playlist-current[\s\S]*本地歌曲/);
  state.playlistIndex = 1;
  popup.render(state);
  assert.match(list.innerHTML, /playlist-past[\s\S]*本地歌曲[\s\S]*playlist-current[\s\S]*第二首/);
  state.normalQueueTracks.splice(1, 1, track('replacement', '同位置替换曲目'));
  popup.render(state);
  assert.match(list.innerHTML, /playlist-current[\s\S]*同位置替换曲目/);
  assert.doesNotMatch(list.innerHTML, /第二首/);
});

test('unchanged queue and search lists survive pause and unrelated provider updates, and reopen with new tracks', async () => {
  const app = await createPlaybackApp({
    current: track('playing', '正在播放'), normalQueue: [track('next', '原下一首')],
    mode: 'sequence', volume: 0.75, selectedSource: 'qq',
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackQueueBtn', 'click');
  app.element('playbackSearchKeyword').value = '新点的歌';
  await app.emit('playbackSearchBtn', 'click');
  const writes = { queue: 0, search: 0 };
  for (const [key, id] of [['queue', 'playbackQueueList'], ['search', 'playbackSearchResults']]) {
    const node = app.element(id);
    let html = node.innerHTML;
    Object.defineProperty(node, 'innerHTML', {
      get: () => html,
      set(value) { writes[key]++; html = value; },
    });
  }

  await app.emit('music-player', 'pause');
  await app.emitWindow('app:wesing-state', { detail: { currentMs: 1000, playing: true } });
  assert.deepEqual(writes, { queue: 0, search: 0 });
  await app.emit('queuePopupClose', 'click');
  await app.emit('playbackSearchResults', 'click', {
    target: closestTarget({ playbackSearchAction: 'normal', playbackSearchIndex: '0' }, 'playback-search-action'),
  });
  assert.deepEqual(writes, { queue: 0, search: 0 }, 'closed queues defer rendering without rebuilding search results');
  await app.emit('playbackQueueBtn', 'click');
  assert.equal(writes.queue, 1);
  assert.match(app.element('playbackQueueList').innerHTML, /原下一首[\s\S]*新点的歌/);
  await app.emit('playbackSearchClearBtn', 'click');
  assert.equal(app.element('playbackSearchResults').innerHTML, '');
});

for (const [queueType, mode] of [['queue', 'sequence'], ['queue', 'shuffle'], ['playlist', 'sequence'], ['playlist', 'shuffle'], ['radio', 'shuffle']]) {
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
  const duplicate = app.emit('playbackImportSongQueue', 'click');
  assert.equal(app.element('playbackImportSongQueue').disabled, true);
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
  assert.equal(app.element('playbackImportSongQueue').disabled, false);
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
  await app.emit('playbackQueueBtn', 'click');

  assert.equal(app.element('queuePopupTitle').textContent, '歌单队列');
  assert.equal(app.element('queuePopupSize').textContent, '3 首');
  assert.match(app.element('playbackQueueList').innerHTML, /歌单第二首[\s\S]*歌单第三首/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /不应显示的电台歌曲|不应保留的电台歌曲/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /插队/);

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
  assert.equal(persisted.queueTitle, '历史播放');
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
  await app.emit('playbackQueueBtn', 'click');
  assert.equal(app.element('queuePopupTitle').textContent, '历史播放');

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

  assert.match(app.element('playbackDrawerBody').innerHTML, /data-playback-home-track-row-index="1"/);

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
  assert.equal(persisted.queueTitle, '每日推荐');
  assert.equal(persisted.queueSourceKey, 'qq:daily');
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

test('previous playback pops history once without pushing the current track back', async () => {
  const app = await createPlaybackApp({
    current: track('current', 'Current'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    history: [track('older', 'Older'), track('previous', 'Previous')],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75,
  });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPrev', 'click');
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'previous');
  assert.deepEqual(
    persisted.history.map((item) => item.id),
    ['older'],
  );
});

test('audio errors refresh the current stream and skip safely after the retry limit', async () => {
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

  await assert.doesNotReject(app.emit('music-player', 'error'));
  await flushAsyncWork();

  assert.equal(app.savedState().current.id, 'current');
  assert.equal(app.audioPlayCalls(), 1);
  assert.equal(app.resolveStreamRequestCount(), 1);
  assert.deepEqual(app.errors(), []);

  await assert.doesNotReject(app.emit('music-player', 'error'));
  await flushAsyncWork();

  assert.equal(app.savedState().current.id, 'next');
  assert.equal(app.audioPlayCalls(), 2);
  assert.equal(app.resolveStreamRequestCount(), 2);
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
