'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  closestTarget,
  createPlaybackApp,
  flushAsyncWork,
  track
} = require('./helpers/playback-app');

test('quality selection refreshes the current stream and persists the provider preference', async () => {
  const current = track('quality-song', '音质测试');
  let requestBody;
  const app = await createPlaybackApp({
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
    volume: 0.75
  }, {
    async resolveStream(_count, body) {
      requestBody = body;
      return {
        url: 'https://example.test/high.mp3',
        requestedQuality: 'lossless',
        quality: 'high'
      };
    }
  });

  await app.init();
  await flushAsyncWork();
  app.element('music-player').currentTime = 47;

  await app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {},
    target: closestTarget({ playbackQuality: 'lossless' }, 'data-playback-quality')
  });
  await app.emit('music-player', 'loadedmetadata');
  await app.emitWindow('pagehide');

  assert.equal(requestBody.quality, 'lossless');
  assert.equal(requestBody.track.sourceTrackId, 'quality-song');
  assert.equal(app.element('music-player').src, 'https://example.test/high.mp3');
  assert.equal(app.element('music-player').currentTime, 47);
  assert.equal(app.element('playbackQualityLabel').textContent, 'HQ');
  assert.equal(app.ipcSavedState().qualityPreferences.qq, 'lossless');
});
