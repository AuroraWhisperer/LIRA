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

test('playlist playback keeps one queue and loops with directly played search tracks', async () => {
  const savedState = {
    current: track('playlist-1', '歌单第一首'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [
      track('playlist-2', '歌单第二首'),
      track('playlist-3', '歌单第三首')
    ],
    normalQueueTracks: [
      track('playlist-1', '歌单第一首'),
      track('playlist-2', '歌单第二首'),
      track('playlist-3', '歌单第三首')
    ],
    radioQueue: [
      track('radio-1', '不应显示的电台歌曲'),
      track('radio-2', '不应保留的电台歌曲')
    ],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '歌单队列',
    playlistIndex: 0,
    volume: 0.75
  };
  const app = await createPlaybackApp(savedState);

  await app.init();
  await flushAsyncWork();

  assert.equal(app.element('queuePopupTitle').textContent, '歌单队列');
  assert.equal(app.element('queuePopupSize').textContent, '3 首');
  assert.match(app.element('playbackQueueList').innerHTML, /歌单第二首[\s\S]*歌单第三首/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /不应显示的电台歌曲|不应保留的电台歌曲/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /插队/);

  app.element('playbackSearchKeyword').value = '新点的歌';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', {
    target: closestTarget({
      playbackSearchAction: 'play',
      playbackSearchIndex: '0'
    }, 'playback-search-action')
  });
  await flushAsyncWork();

  let persisted = app.savedState();
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.current.id, 'searched');
  assert.equal(persisted.playlistIndex, 1);
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'playlist-1',
    'searched',
    'playlist-2',
    'playlist-3'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'playlist-2',
    'playlist-3'
  ]);
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
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'searched',
    'playlist-2',
    'playlist-3'
  ]);
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
    volume: 0.75
  });

  await app.init();
  await flushAsyncWork();

  app.element('playbackSearchKeyword').value = '新想听的歌';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', {
    target: closestTarget({
      playbackSearchAction: 'play',
      playbackSearchIndex: '0'
    }, 'playback-search-action')
  });
  await flushAsyncWork();

  let persisted = app.savedState();
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.queueTitle, '历史播放');
  assert.equal(persisted.current.id, 'searched');
  assert.equal(persisted.playlistIndex, 0);
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'searched',
    'radio-current',
    'history-old'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'radio-current',
    'history-old'
  ]);
  assert.deepEqual(persisted.radioQueue, []);
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
    track('daily-3', '每日第三首')
  ];
  const app = await createPlaybackApp({
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
    volume: 0.75
  }, {
    authState: { platform: 'qq', loggedIn: true },
    homeAction: 'daily',
    homeTracks: visibleTracks
  });

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();

  assert.match(
    app.element('playbackDrawerBody').innerHTML,
    /data-playback-home-track-row-index="1"/
  );

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackMenuIndex: '1' }, 'playback-home-track-menu-index')
  });
  assert.equal(app.savedState().current.id, 'old-current', 'the menu button must not play its row');

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackRowIndex: '1' }, 'playback-home-track-row-index')
  });
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'daily-2');
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.queueTitle, '每日推荐');
  assert.equal(persisted.queueSourceKey, 'qq:daily');
  assert.equal(persisted.playlistIndex, 1);
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'daily-1',
    'daily-2',
    'daily-3'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), ['daily-3']);
  assert.deepEqual(persisted.requestedQueue, []);
  assert.deepEqual(persisted.radioQueue, []);
});

test('clicking a track in the active playlist jumps without duplicating or replacing that queue', async () => {
  const likedTracks = [
    track('liked-1', '霓虹派对'),
    track('liked-2', '枪火'),
    track('liked-3', '贩卖日落'),
    track('liked-4', 'China-2')
  ];
  const searchedTrack = track('searched-between', '搜索插入歌曲');
  const app = await createPlaybackApp({
    current: likedTracks[3],
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [
      likedTracks[0],
      searchedTrack,
      likedTracks[1],
      likedTracks[2],
      likedTracks[3]
    ],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '我喜欢',
    queueSourceKey: 'qq:liked',
    playlistIndex: 4,
    volume: 0.75
  }, {
    authState: { platform: 'qq', loggedIn: true },
    homeAction: 'liked',
    homeTracks: likedTracks
  });

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();

  const clickFirstLikedTrack = () => app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({
      playbackHomeTrackAction: 'play',
      playbackHomeTrackIndex: '0'
    }, 'playback-home-track-action')
  });
  await Promise.all([clickFirstLikedTrack(), clickFirstLikedTrack()]);
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'liked-1');
  assert.equal(persisted.playlistIndex, 0);
  assert.equal(persisted.queueSourceKey, 'qq:liked');
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'liked-1',
    'searched-between',
    'liked-2',
    'liked-3',
    'liked-4'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'searched-between',
    'liked-2',
    'liked-3',
    'liked-4'
  ]);
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
    volume: 0.75
  });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPrev', 'click');
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'previous');
  assert.deepEqual(persisted.history.map((item) => item.id), ['older']);
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
    volume: 0.75
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
