'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { closestTarget, createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');

function streamFor(request) {
  return {
    url: `https://example.test/${request.track.sourceTrackId}-${request.quality}.mp3`,
    quality: request.quality,
  };
}

async function createPlayingApp(resolveStream, stateOverrides = {}, options = {}) {
  const current = track('a', '歌曲 A');
  const next = track('b', '歌曲 B');
  const last = track('c', '歌曲 C');
  const app = await createPlaybackApp(
    {
      current,
      currentOrigin: 'normal',
      normalQueue: [next, last],
      normalQueueTracks: [current, next, last],
      mode: 'sequence',
      volume: 0.75,
      selectedSource: 'qq',
      queueType: 'queue',
      ...stateOverrides,
    },
    { ...options, resolveStream },
  );
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
      const expectedAudio = {
        src: audio.src,
        trackId: audio.dataset.trackId,
        paused: audio.paused,
        time: audio.currentTime,
      };
      const expectedPlays = app.audioPlayCalls();
      const expectedToasts = app.element('toast').prepended.slice();

      if (result === 'failure') refresh.reject(new Error('obsolete refresh failure'));
      else refresh.resolve(result === 'empty' ? {} : { url: 'https://example.test/a-retry.mp3' });
      await recovery;
      await flushAsyncWork();

      assert.deepEqual(app.errors(), []);
      assert.deepEqual(app.savedState(), expected);
      assert.deepEqual(
        {
          src: audio.src,
          trackId: audio.dataset.trackId,
          paused: audio.paused,
          time: audio.currentTime,
        },
        expectedAudio,
      );
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
  assert.deepEqual(
    app.savedState().normalQueue.map((item) => item.id),
    ['c'],
  );
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
  assert.ok(
    app
      .element('toast')
      .prepended.some((item) =>
        item.children[0].children.some(
          (child) => child.tagName === 'span' && child.textContent === 'current refresh failed',
        ),
      ),
  );
});

test('automatic error recovery also skips an unavailable next track', async () => {
  const { app, audio } = await createPlayingApp((_count, request) => {
    if (request.forceRefresh) throw new Error('current refresh failed');
    if (request.track.sourceTrackId === 'b') return {};
    return streamFor(request);
  });
  await app.emit('music-player', 'error');
  await flushAsyncWork();
  assert.equal(audio.dataset.trackId, 'c');
  assert.equal(audio.paused, false);
  assert.equal(app.savedState().current.id, 'c');
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

for (const failure of ['empty', 'error']) {
  test(`automatic advancement skips an unavailable track (${failure})`, async () => {
    const requests = [];
    const { app, audio } = await createPlayingApp((_count, request) => {
      requests.push(request.track.sourceTrackId);
      if (request.track.sourceTrackId === 'b') {
        if (failure === 'error') throw new Error('该歌曲暂无可用播放地址');
        return {};
      }
      return streamFor(request);
    });
    audio.paused = true;
    await app.emit('music-player', 'ended');
    await flushAsyncWork();

    assert.equal(audio.dataset.trackId, 'c');
    assert.equal(audio.paused, false);
    assert.equal(app.savedState().current.id, 'c');
    assert.deepEqual(requests, ['a', 'b', 'c']);
    assert.equal(app.audioPlayCalls(), 2);
  });
}

for (const stateOverrides of [
  { queueType: 'queue' },
  { queueType: 'playlist', playlistIndex: 0 },
  { queueType: 'playlist', playlistIndex: 0, mode: 'repeat-one' },
]) {
  test(`automatic advancement stops when every candidate is unavailable (${JSON.stringify(stateOverrides)})`, async () => {
    const requests = [];
    const { app, audio } = await createPlayingApp((count, request) => {
      requests.push(request.track.sourceTrackId);
      if (count === 1) return { ...streamFor(request), expireAt: 1 };
      // Bound a broken implementation too, so this regression cannot spin indefinitely.
      if (requests.length > 10) return new Promise(() => {});
      throw new Error('该歌曲暂无可用播放地址');
    }, stateOverrides);
    audio.paused = true;
    await app.emit('music-player', 'ended');
    await flushAsyncWork();

    assert.equal(audio.src, '');
    assert.equal(audio.paused, true);
    assert.equal(app.audioPlayCalls(), 1);
    const expectedCandidates = stateOverrides.queueType === 'playlist' ? ['a', 'b', 'c'] : ['b', 'c'];
    assert.deepEqual(requests.slice(1).sort(), expectedCandidates);
    assert.deepEqual(app.savedState().normalQueue, []);
  });
}

test('automatic radio advancement reaches songs refilled while an unavailable song is resolving', async () => {
  const unavailable = Promise.withResolvers();
  const refill = Promise.withResolvers();
  const { app, audio } = await createPlayingApp((_count, request) =>
    request.track.sourceTrackId === 'b' ? unavailable.promise : streamFor(request),
  {
    queueType: 'radio', queueSourceKey: 'qq:radio', currentOrigin: 'radio',
    normalQueue: [], normalQueueTracks: [], radioQueue: [track('b', '不可播歌曲')],
  }, { loadHome: () => refill.promise });
  audio.paused = true;
  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  refill.resolve({ tracks: [track('c', '补充的可播歌曲')] });
  await flushAsyncWork();
  unavailable.resolve({});
  await flushAsyncWork();

  assert.equal(audio.dataset.trackId, 'c');
  assert.equal(audio.paused, false);
  assert.equal(app.audioPlayCalls(), 2);
});

test('automatic radio advancement stops even when refills keep returning unavailable songs', async () => {
  let batch = 0;
  const { app, audio } = await createPlayingApp((count, request) => {
    if (count === 1) return streamFor(request);
    if (count > 20) return new Promise(() => {});
    return {};
  }, {
    queueType: 'radio', queueSourceKey: 'qq:radio', currentOrigin: 'radio',
    normalQueue: [], normalQueueTracks: [], radioQueue: [track('b', '不可播歌曲')],
  }, {
    loadHome() {
      batch += 1;
      return { tracks: Array.from({ length: 10 }, (_, index) => track(`batch-${batch}-${index}`, '不可播歌曲')) };
    },
  });
  audio.paused = true;
  await app.emit('music-player', 'ended');
  await flushAsyncWork();

  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal(app.audioPlayCalls(), 1);
  assert.ok(app.resolveStreamRequestCount() <= 12, 'one queued song and at most one refill batch are attempted');
});

test('automatic advancement can wrap the playlist after its remaining songs are unavailable', async () => {
  const requests = [];
  const { app, audio } = await createPlayingApp((_count, request) => {
    requests.push(request.track.sourceTrackId);
    return request.track.sourceTrackId === 'a' ? streamFor(request) : {};
  }, { queueType: 'playlist', playlistIndex: 0 });
  audio.paused = true;
  await app.emit('music-player', 'ended');
  await flushAsyncWork();

  assert.equal(audio.dataset.trackId, 'a');
  assert.equal(audio.paused, false);
  assert.equal(app.audioPlayCalls(), 2);
  assert.equal(app.savedState().playlistIndex, 0);
  assert.deepEqual(requests, ['a', 'b', 'c', 'a']);
});

for (const action of ['next', 'clear']) {
  for (const failure of ['empty', 'error']) {
    test(`obsolete automatic advancement cannot continue after ${action} (${failure})`, async () => {
      const pending = Promise.withResolvers();
      const { app, audio } = await createPlayingApp((_count, request) =>
        request.track.sourceTrackId === 'b' ? pending.promise : streamFor(request),
      );
      audio.paused = true;
      await app.emit('music-player', 'ended');
      await flushAsyncWork();
      await app.emit(action === 'next' ? 'playbackNext' : 'playbackClearQueue', 'click');
      await flushAsyncWork();
      const expectedState = app.savedState();
      const expectedAudio = { src: audio.src, paused: audio.paused, trackId: audio.dataset.trackId };
      const expectedCalls = app.resolveStreamRequestCount();

      if (failure === 'error') pending.reject(new Error('obsolete unavailable track'));
      else pending.resolve({});
      await flushAsyncWork();

      assert.deepEqual(app.savedState(), expectedState);
      assert.deepEqual({ src: audio.src, paused: audio.paused, trackId: audio.dataset.trackId }, expectedAudio);
      assert.equal(app.resolveStreamRequestCount(), expectedCalls);
    });
  }
}
