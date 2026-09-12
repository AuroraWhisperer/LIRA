'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  closestTarget,
  createPlaybackApp,
  flushAsyncWork,
  track,
} = require('./helpers/playback-app');

function streamFor(request) {
  return {
    url: `https://example.test/${request.track.sourceTrackId}-${request.quality}.mp3`,
    quality: request.quality,
  };
}

async function createPlayingApp(resolveStream) {
  const current = track('a', '歌曲 A');
  const next = track('b', '歌曲 B');
  const last = track('c', '歌曲 C');
  const app = await createPlaybackApp({
    current,
    currentOrigin: 'normal',
    normalQueue: [next, last],
    normalQueueTracks: [current, next, last],
    mode: 'sequence',
    volume: 0.75,
    selectedSource: 'qq',
    queueType: 'queue',
  }, { resolveStream });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  const audio = app.element('music-player');
  assert.equal(audio.dataset.trackId, 'a');
  assert.equal(audio.paused, false);
  assert.equal(app.audioPlayCalls(), 1);
  audio.readyState = 1;
  audio.currentTime = 42;
  return { app, audio };
}

for (const action of ['next', 'clear', 'quality']) {
  for (const result of ['success', 'failure', 'empty']) {
    test(`obsolete stream recovery cannot affect playback after ${action} (${result})`, async () => {
      const refresh = Promise.withResolvers();
      const { app, audio } = await createPlayingApp((_count, request) => {
        if (request.forceRefresh && request.quality === 'standard') return refresh.promise;
        return streamFor(request);
      });
      const recovery = app.emit('music-player', 'error');
      await flushAsyncWork();
      if (action === 'quality') {
        await app.emit('playbackQualityPanel', 'click', {
          stopPropagation() {},
          target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
        });
      } else {
        await app.emit(action === 'next' ? 'playbackNext' : 'playbackClearQueue', 'click');
      }
      await flushAsyncWork();
      const expected = app.savedState();
      const expectedAudio = { src: audio.src, trackId: audio.dataset.trackId, paused: audio.paused, time: audio.currentTime };
      const expectedPlays = app.audioPlayCalls();
      const expectedToasts = app.element('toast').prepended.slice();

      if (result === 'failure') refresh.reject(new Error('obsolete refresh failure'));
      else refresh.resolve(result === 'empty' ? {} : { url: 'https://example.test/a-retry.mp3' });
      await recovery;
      await flushAsyncWork();

      assert.deepEqual(app.errors(), []);
      assert.deepEqual(app.savedState(), expected);
      assert.deepEqual({ src: audio.src, trackId: audio.dataset.trackId, paused: audio.paused, time: audio.currentTime }, expectedAudio);
      assert.equal(app.audioPlayCalls(), expectedPlays);
      assert.deepEqual(app.element('toast').prepended, expectedToasts);
    });
  }
}

test('an error from the old audio cannot cancel a newer track still resolving its URL', async () => {
  const nextStream = Promise.withResolvers();
  const { app, audio } = await createPlayingApp((_count, request) =>
    request.track.sourceTrackId === 'b' ? nextStream.promise : streamFor(request),
  );
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  await app.emit('music-player', 'error');
  nextStream.resolve({ url: 'https://example.test/b-new.mp3' });
  await flushAsyncWork();

  assert.equal(app.resolveStreamRequestCount(), 2);
  assert.equal(app.savedState().current.id, 'b');
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(audio.src, 'https://example.test/b-new.mp3');
  assert.deepEqual(app.errors(), []);
});

test('current stream recovery resumes the track and still skips after its retry is exhausted', async () => {
  const { app, audio } = await createPlayingApp((_count, request) =>
    request.forceRefresh ? { url: 'https://example.test/a-refreshed.mp3' } : streamFor(request),
  );
  await app.emit('music-player', 'error');
  await flushAsyncWork();
  assert.equal(audio.src, 'https://example.test/a-refreshed.mp3');
  assert.equal(audio.currentTime, 42);
  assert.equal(audio.dataset.trackId, 'a');
  assert.equal(app.audioPlayCalls(), 2);

  await app.emit('music-player', 'error');
  await flushAsyncWork();
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(audio.src, 'https://example.test/b-standard.mp3');
  assert.deepEqual(app.savedState().normalQueue.map((item) => item.id), ['c']);
  assert.deepEqual(app.errors(), []);
});

test('a current refresh failure reports its error and advances to the next track', async () => {
  const { app, audio } = await createPlayingApp((_count, request) => {
    if (request.forceRefresh) throw new Error('current refresh failed');
    return streamFor(request);
  });
  await app.emit('music-player', 'error');
  await flushAsyncWork();
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(audio.src, 'https://example.test/b-standard.mp3');
  assert.ok(app.element('toast').prepended.some((item) => item.textContent === 'current refresh failed'));
});

for (const action of ['next', 'quality']) {
  for (const failure of ['empty', 'error']) {
    test(`retained audio can recover from a new error after ${action} fails (${failure})`, async () => {
      let selectionFailed = true;
      const { app, audio } = await createPlayingApp((_count, request) => {
        if (selectionFailed && (request.track.sourceTrackId === 'b' || request.quality === 'high')) {
          if (failure === 'error') throw new Error('new selection failed');
          return {};
        }
        return streamFor(request);
      });
      if (action === 'quality') {
        await app.emit('playbackQualityPanel', 'click', {
          stopPropagation() {},
          target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
        });
      } else {
        await app.emit('playbackNext', 'click');
      }
      await flushAsyncWork();
      assert.equal(audio.dataset.trackId, 'a');
      assert.equal(audio.paused, false);

      selectionFailed = false;
      await app.emit('music-player', 'error');
      await flushAsyncWork();
      assert.equal(audio.dataset.trackId, 'a');
      assert.equal(audio.paused, false);
      assert.equal(app.audioPlayCalls(), 2);
    });
  }
}

for (const emptyStream of [null, {}, { url: '' }]) {
  test(`a new track with no URL retains the original display and audio (${JSON.stringify(emptyStream)})`, async () => {
    const { app, audio } = await createPlayingApp((_count, request) =>
      request.track.sourceTrackId === 'b' ? emptyStream : streamFor(request),
    );
    const previousHistory = app.savedState().displayHistory;
    await app.emit('playbackNext', 'click');
    await flushAsyncWork();
    await app.emitWindow('pagehide');

    assert.equal(app.element('playbackTrackTitle').textContent, '歌曲 A');
    assert.equal(audio.dataset.trackId, 'a');
    assert.equal(audio.src, 'https://example.test/a-standard.mp3');
    assert.equal(audio.paused, false);
    assert.equal(audio.currentTime, 42);
    assert.equal(app.audioPlayCalls(), 1);
    assert.equal(app.ipcSavedState().current.id, 'a');
    assert.equal(app.ipcSavedState().currentOrigin, 'normal');
    assert.equal(app.ipcSavedState().currentTime, 42);
    assert.deepEqual(app.ipcSavedState().displayHistory, previousHistory);
    assert.deepEqual(app.errors(), []);
  });
}
