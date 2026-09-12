'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  closestTarget,
  createPlaybackApp,
  flushAsyncWork,
  track,
} = require('./helpers/playback-app');

test('quality selection refreshes the current stream and persists the provider preference', async () => {
  const current = {
    ...track('quality-song', '音质测试'),
    sourceSongType: 1,
  };
  let requestBody;
  const app = await createPlaybackApp(
    {
      current,
      currentOrigin: 'normal',
      requestedQueue: [],
      normalQueue: [],
      normalQueueTracks: [current],
      radioQueue: [],
      history: [],
      displayHistory: [],
      mode: 'sequence',
      selectedSource: 'qq',
      queueType: 'playlist',
      queueTitle: '音质测试',
      playlistIndex: 0,
      volume: 0.75,
    },
    {
      async resolveStream(_count, body) {
        requestBody = body;
        return {
          url: 'https://example.test/high.mp3',
          requestedQuality: 'lossless',
          quality: 'high',
        };
      },
    },
  );

  await app.init();
  await flushAsyncWork();
  app.element('music-player').currentTime = 47;

  await app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {},
    target: closestTarget(
      { playbackQuality: 'lossless' },
      'data-playback-quality',
    ),
  });
  await app.emit('music-player', 'loadedmetadata');
  await app.emitWindow('pagehide');

  assert.equal(requestBody.quality, 'lossless');
  assert.equal(requestBody.track.sourceTrackId, 'quality-song');
  assert.equal(requestBody.track.sourceSongType, 1);
  assert.equal(
    app.element('music-player').src,
    'https://example.test/high.mp3',
  );
  assert.equal(app.element('music-player').currentTime, 47);
  assert.equal(app.element('playbackQualityLabel').textContent, 'HQ');
  assert.equal(app.ipcSavedState().qualityPreferences.qq, 'lossless');
});

test('a stale quality stream cannot replace a newer quality selection', async () => {
  let resolveLossless;
  let rejectPremium;
  const losslessStream = new Promise((resolve) => {
    resolveLossless = resolve;
  });
  const premiumStream = new Promise((_resolve, reject) => {
    rejectPremium = reject;
  });
  const app = await createPlaybackApp(
    {
      current: track('quality-race-song', '音质竞态测试'),
      currentOrigin: 'normal',
      requestedQueue: [],
      normalQueue: [],
      normalQueueTracks: [track('quality-race-song', '音质竞态测试')],
      radioQueue: [],
      history: [],
      displayHistory: [],
      mode: 'sequence',
      selectedSource: 'qq',
      queueType: 'playlist',
      queueTitle: '音质竞态测试',
      playlistIndex: 0,
      volume: 0.75,
    },
    {
      async resolveStream(_requestCount, requestBody) {
        if (requestBody.quality === 'lossless') return losslessStream;
        if (requestBody.quality === 'premium') return premiumStream;
        if (requestBody.quality === 'high') {
          return {
            url: 'https://example.test/high.mp3',
            requestedQuality: 'high',
            quality: 'high',
          };
        }
        return { url: 'https://example.test/standard.mp3' };
      },
    },
  );

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();

  const staleQualityRequest = app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {},
    target: closestTarget(
      { playbackQuality: 'lossless' },
      'data-playback-quality',
    ),
  });
  await flushAsyncWork();

  await app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {},
    target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
  });
  await flushAsyncWork();

  resolveLossless({
    url: 'https://example.test/lossless.mp3',
    requestedQuality: 'lossless',
    quality: 'lossless',
  });
  await staleQualityRequest;
  await flushAsyncWork();

  assert.equal(app.element('music-player').src, 'https://example.test/high.mp3');
  assert.equal(app.element('music-player').paused, false);
  assert.equal(app.audioPlayCalls(), 2);
  await app.emit('music-player', 'loadedmetadata');
  assert.equal(app.element('playbackQualityLabel').textContent, 'HQ');

  const staleQualityError = app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {},
    target: closestTarget(
      { playbackQuality: 'premium' },
      'data-playback-quality',
    ),
  });
  await flushAsyncWork();
  await app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {},
    target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
  });
  await flushAsyncWork();
  rejectPremium(new Error('stale quality request failed'));
  await staleQualityError;
  await flushAsyncWork();

  assert.equal(app.element('music-player').src, 'https://example.test/high.mp3');
  assert.equal(app.element('music-player').paused, false);
  assert.equal(app.audioPlayCalls(), 3);
  assert.deepEqual(app.errors(), []);
});

test('a stale quality stream cannot replace the next track', async () => {
  let resolveLossless;
  const losslessStream = new Promise((resolve) => {
    resolveLossless = resolve;
  });
  const current = track('quality-old-song', '旧音质歌曲');
  const next = track('quality-new-song', '新音质歌曲');
  const app = await createPlaybackApp(
    {
      current,
      currentOrigin: 'normal',
      requestedQueue: [],
      normalQueue: [next],
      normalQueueTracks: [current, next],
      radioQueue: [],
      history: [],
      displayHistory: [],
      mode: 'sequence',
      selectedSource: 'qq',
      queueType: 'queue',
      queueTitle: '跨曲音质竞态测试',
      playlistIndex: -1,
      restoredTime: 47,
      volume: 0.75,
    },
    {
      async resolveStream(_requestCount, requestBody) {
        if (
          requestBody.track.sourceTrackId === current.sourceTrackId &&
          requestBody.quality === 'lossless'
        ) {
          return losslessStream;
        }
        if (requestBody.track.sourceTrackId === next.sourceTrackId) {
          return {
            url: 'https://example.test/new.mp3',
            requestedQuality: requestBody.quality,
            quality: 'high',
          };
        }
        return { url: 'https://example.test/old.mp3' };
      },
    },
  );

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();

  const staleQualityRequest = app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {},
    target: closestTarget(
      { playbackQuality: 'lossless' },
      'data-playback-quality',
    ),
  });
  await flushAsyncWork();

  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, next.id);
  assert.equal(app.element('music-player').src, 'https://example.test/new.mp3');
  assert.equal(app.element('music-player').paused, false);

  app.element('music-player').currentTime = 7;
  await app.emit('music-player', 'loadedmetadata');
  assert.equal(
    app.element('music-player').currentTime,
    7,
    'the old track metadata callback must not seek the next track',
  );

  resolveLossless({
    url: 'https://example.test/old-lossless.mp3',
    requestedQuality: 'lossless',
    quality: 'lossless',
  });
  await staleQualityRequest;
  await flushAsyncWork();

  assert.equal(app.savedState().current.id, next.id);
  assert.equal(app.element('music-player').src, 'https://example.test/new.mp3');
  assert.equal(app.element('music-player').paused, false);
  assert.deepEqual(app.errors(), []);
});

test('a late play completion cannot seek a newer track', async () => {
  let resolveInitialPlay;
  const initialPlay = new Promise((resolve) => {
    resolveInitialPlay = resolve;
  });
  const current = track('late-play-old-song', '旧播放歌曲');
  const next = track('late-play-new-song', '新播放歌曲');
  const app = await createPlaybackApp(
    {
      current,
      currentOrigin: 'normal',
      requestedQueue: [],
      normalQueue: [next],
      normalQueueTracks: [current, next],
      radioQueue: [],
      history: [],
      displayHistory: [],
      mode: 'sequence',
      selectedSource: 'qq',
      queueType: 'queue',
      queueTitle: '迟到播放竞态测试',
      playlistIndex: -1,
      restoredTime: 47,
      volume: 0.75,
    },
    {
      async resolveStream(_requestCount, requestBody) {
        return {
          url:
            requestBody.track.sourceTrackId === next.sourceTrackId
              ? 'https://example.test/new.mp3'
              : 'https://example.test/old.mp3',
        };
      },
    },
  );

  await app.init();
  await flushAsyncWork();
  const audio = app.element('music-player');
  const defaultPlay = audio.play.bind(audio);
  let playCount = 0;
  audio.play = async () => {
    playCount += 1;
    if (playCount === 1) return initialPlay;
    return defaultPlay();
  };

  const stalePlaybackRequest = app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();

  assert.equal(app.savedState().current.id, next.id);
  assert.equal(audio.src, 'https://example.test/new.mp3');
  audio.currentTime = 7;
  await app.emit('music-player', 'loadedmetadata');
  assert.equal(audio.currentTime, 7);

  resolveInitialPlay();
  await stalePlaybackRequest;
  await flushAsyncWork();

  assert.equal(app.savedState().current.id, next.id);
  assert.equal(audio.currentTime, 7);
  assert.equal(audio.paused, false);
  assert.deepEqual(app.errors(), []);
});
