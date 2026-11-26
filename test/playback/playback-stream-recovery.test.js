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

for (const ids of [['a'], ['a', 'b']]) {
  test(`persistent decode errors exhaust a ${ids.length}-song playlist`, async () => {
    const songs = ids.map(id => track(id, id));
    const { app, audio } = await createPlayingApp((_count, request) => streamFor(request), {
      queueType: 'playlist', normalQueueTracks: songs, normalQueue: songs.slice(1), playlistIndex: 0,
    });
    audio.error = { code: 3 };
    for (const id of ids) {
      assert.equal(audio.dataset.trackId, id);
      await app.emit('music-player', 'error');
      await flushAsyncWork();
      assert.equal(audio.dataset.trackId, id, 'one URL refresh for the current song');
      await app.emit('music-player', 'error');
      await flushAsyncWork();
    }
    assert.equal(audio.src, '');
    assert.equal(audio.paused, true);
    await app.emit('music-player', 'error');
    assert.equal(app.audioPlayCalls(), 2 * ids.length);
    await app.emit('playbackPlayPause', 'click');
    assert.equal(app.audioPlayCalls(), 2 * ids.length + 1, 'an explicit replay starts a fresh attempt');
  });
}

test('a normal queue tries the separately queued copy of a song after its current copy fails decoding', async () => {
  const second = { ...track('a', '歌曲 A'), requestedBy: '乙' };
  const { app, audio } = await createPlayingApp((_count, request) => streamFor(request), {
    normalQueue: [second, track('b', '歌曲 B')], normalQueueTracks: [],
  });
  audio.error = { code: 3 };
  for (let i = 0; i < 2; i++) {
    await app.emit('music-player', 'error');
    await flushAsyncWork();
  }
  assert.equal(audio.dataset.trackId, 'a');
  assert.equal(app.savedState().current.requestedBy, '乙');
  assert.deepEqual(app.savedState().normalQueue.map(song => song.id), ['b']);
});

test('a failed URL lookup gives the next independent normal queue entry its own attempt', async () => {
  const queued = track('b', '歌曲 B');
  const requests = [];
  const { app, audio } = await createPlayingApp((count, request) => {
    requests.push(request.track.sourceTrackId);
    return count === 2 ? {} : streamFor(request);
  }, { normalQueue: [queued, { ...queued, requestedBy: '乙' }], normalQueueTracks: [] });
  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.deepEqual(requests, ['a', 'b', 'b']);
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(app.savedState().current.requestedBy, '乙');
});

test('a healthy successor plays after a decode failure and natural completion starts a new playlist pass', async () => {
  const { app, audio } = await createPlayingApp((_count, request) => streamFor(request), {
    queueType: 'playlist', normalQueue: [track('b', 'B')], normalQueueTracks: [track('a', 'A'), track('b', 'B')],
    playlistIndex: 0,
  });
  for (let i = 0; i < 2; i++) {
    await app.emit('music-player', 'error');
    await flushAsyncWork();
  }
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(audio.paused, false);
  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.equal(audio.dataset.trackId, 'a');
  assert.equal(app.audioPlayCalls(), 4);
});

test('a successor that played before failing can wrap to a recovered playlist track', async () => {
  const songs = ['a', 'b'].map(id => track(id, id));
  const { app, audio } = await createPlayingApp((_count, request) => streamFor(request), {
    queueType: 'playlist', normalQueueTracks: songs, normalQueue: songs.slice(1), playlistIndex: 0,
  });
  const failAfterRefresh = async () => {
    await app.emit('music-player', 'error');
    await flushAsyncWork();
    await app.emit('music-player', 'error');
    await flushAsyncWork();
  };
  await failAfterRefresh();
  assert.equal(audio.dataset.trackId, 'b');
  audio.currentTime = 24;
  audio.played = { length: 1, start: () => 0, end: () => audio.currentTime };
  await app.emit('music-player', 'timeupdate');
  await failAfterRefresh();
  assert.equal(audio.dataset.trackId, 'a');
  assert.equal(audio.paused, false);
});

test('a healthy one-song playlist still repeats after natural completion', async () => {
  const { app, audio } = await createPlayingApp((_count, request) => streamFor(request), {
    queueType: 'playlist', normalQueue: [], normalQueueTracks: [track('a', 'A')], playlistIndex: 0,
  });
  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.equal(audio.dataset.trackId, 'a');
  assert.equal(app.audioPlayCalls(), 2);
});

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

for (const event of ['error', 'ended']) {
  test(`an ${event} event from the old audio cannot cancel a newer track still resolving its URL`, async () => {
    const nextStream = Promise.withResolvers();
    const { app, audio } = await createPlayingApp((_count, request) =>
      request.track.sourceTrackId === 'b' ? nextStream.promise : streamFor(request),
    );
    await app.emit('playbackNext', 'click');
    await flushAsyncWork();
    if (event === 'ended') {
      audio.paused = true;
      audio.ended = true;
    }
    await app.emit('music-player', event);
    nextStream.resolve({ url: 'https://example.test/b-new.mp3' });
    await flushAsyncWork();

    assert.equal(app.resolveStreamRequestCount(), 2);
    assert.equal(app.savedState().current.id, 'b');
    assert.equal(audio.dataset.trackId, 'b');
    assert.equal(audio.src, 'https://example.test/b-new.mp3');
    assert.deepEqual(app.savedState().normalQueue.map(item => item.id), ['c']);
    assert.deepEqual(app.errors(), []);
  });
}

for (const event of ['error', 'ended']) {
  test(`a pending quality replacement ${event === 'ended' ? 'allows natural advancement' : 'ignores old audio errors'}`, async () => {
    const qualityStream = Promise.withResolvers();
    const { app, audio } = await createPlayingApp((_count, request) =>
      request.quality === 'high' ? qualityStream.promise : streamFor(request),
    );
    const selection = app.emit('playbackQualityPanel', 'click', {
      stopPropagation() {},
      target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
    });
    await flushAsyncWork();
    if (event === 'ended') {
      audio.currentTime = audio.duration;
      audio.paused = true;
      audio.ended = true;
    }
    await app.emit('music-player', event);
    await flushAsyncWork();
    const currentWhilePending = app.savedState().current.id;
    qualityStream.resolve({ url: 'https://example.test/a-high.mp3', quality: 'high' });
    await selection;
    await flushAsyncWork();

    const ended = event === 'ended';
    assert.equal(currentWhilePending, ended ? 'b' : 'a');
    assert.equal(app.resolveStreamRequestCount(), ended ? 3 : 2);
    assert.equal(app.savedState().current.id, ended ? 'b' : 'a');
    assert.equal(audio.dataset.trackId, ended ? 'b' : 'a');
    assert.equal(audio.src, ended ? 'https://example.test/b-standard.mp3' : 'https://example.test/a-high.mp3');
    assert.equal(audio.paused, false);
    assert.deepEqual(app.savedState().normalQueue.map(item => item.id), ended ? ['c'] : ['b', 'c']);
    assert.deepEqual(app.errors(), []);
  });
}

test('pausing during a next-track lookup keeps the selected track paused and resumable', async () => {
  const nextStream = Promise.withResolvers();
  const { app, audio } = await createPlayingApp((_count, request) =>
    request.track.sourceTrackId === 'b' ? nextStream.promise : streamFor(request),
  );
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  nextStream.resolve({ url: 'https://example.test/b-new.mp3' });
  await flushAsyncWork();

  assert.equal(audio.paused, true);
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(app.audioPlayCalls(), 1);
  assert.equal(app.savedState().current.id, 'b');
  assert.deepEqual(app.savedState().normalQueue.map(item => item.id), ['c']);

  await app.emit('playbackPlayPause', 'click');
  assert.equal(audio.paused, false);
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(app.resolveStreamRequestCount(), 2);
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.equal(audio.dataset.trackId, 'c');
  assert.equal(app.savedState().current.id, 'c');
});

test('resuming before a pending next-track lookup completes lets the selected track play', async () => {
  const nextStream = Promise.withResolvers();
  const { app, audio } = await createPlayingApp((_count, request) =>
    request.track.sourceTrackId === 'b' ? nextStream.promise : streamFor(request),
  );
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await app.emit('playbackPlayPause', 'click');
  nextStream.resolve({ url: 'https://example.test/b-new.mp3' });
  await flushAsyncWork();

  assert.equal(audio.paused, false);
  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(app.audioPlayCalls(), 3);
  assert.equal(app.savedState().current.id, 'b');
  assert.deepEqual(app.savedState().normalQueue.map(item => item.id), ['c']);
});

test('pausing during automatic advancement stops a failed lookup from starting another track', async () => {
  const nextStream = Promise.withResolvers();
  const requests = [];
  const { app, audio } = await createPlayingApp((_count, request) => {
    requests.push(request.track.sourceTrackId);
    if (request.forceRefresh) throw new Error('current refresh failed');
    return request.track.sourceTrackId === 'b' ? nextStream.promise : streamFor(request);
  });
  await app.emit('music-player', 'error');
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  nextStream.resolve({});
  await flushAsyncWork();

  assert.equal(audio.paused, true);
  assert.equal(audio.dataset.trackId, 'a');
  assert.deepEqual(requests, ['a', 'a', 'b']);
  assert.deepEqual(app.savedState().normalQueue.map(item => item.id), ['c']);
});

for (const outcome of ['refreshed', 'unavailable']) {
  test(`pausing during stream recovery keeps the current track paused when the stream is ${outcome}`, async () => {
    const refresh = Promise.withResolvers();
    const { app, audio } = await createPlayingApp((_count, request) =>
      request.forceRefresh ? refresh.promise : streamFor(request));
    const recovery = app.emit('music-player', 'error');
    await flushAsyncWork();
    await app.emit('playbackPlayPause', 'click');
    assert.equal(audio.paused, true);

    if (outcome === 'refreshed') refresh.resolve({ url: 'https://example.test/a-retry.mp3' });
    else refresh.reject(new Error('refresh unavailable'));
    await recovery;
    await flushAsyncWork();
    assert.equal(audio.dataset.trackId, 'a');
    assert.equal(app.audioPlayCalls(), 1);
    assert.equal(audio.paused, true);
    assert.deepEqual(app.savedState().normalQueue.map(item => item.id), ['b', 'c']);
    if (outcome === 'refreshed') {
      await app.emit('playbackPlayPause', 'click');
      assert.equal(audio.src, 'https://example.test/a-retry.mp3');
      assert.equal(audio.currentTime, 42);
      assert.equal(audio.paused, false);
      assert.equal(app.resolveStreamRequestCount(), 2);
    }
  });
}

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

for (const readyState of [0, 1]) {
  test(`seeking while a replacement stream resolves preserves the last input (readyState ${readyState})`, async () => {
    const refresh = Promise.withResolvers();
    const { app, audio } = await createPlayingApp((_count, request) =>
      request.forceRefresh ? refresh.promise : streamFor(request));
    Object.assign(audio, { readyState, currentTime: readyState ? 42 : 0, duration: readyState ? 180 : NaN });
    const recovery = app.emit('music-player', 'error');
    await flushAsyncWork();
    const slider = app.element('playbackSeek');
    slider.value = '81';
    await app.emit('playbackSeek', 'input', { target: slider });
    assert.equal(app.savedState().currentTime, 81);
    refresh.resolve({ url: 'https://example.test/refreshed.mp3' });
    await recovery;
    Object.assign(audio, { readyState: 1, duration: 180 });
    await app.emit('music-player', 'loadedmetadata');
    assert.equal(audio.currentTime, 81);
    assert.equal(app.savedState().currentTime, 81);
  });
}

test('NetEase stream recovery preserves the requested quality with one URL refresh', async () => {
  const requests = [];
  const { app, audio } = await createPlayingApp((_count, request) => {
    requests.push(request);
    return { ...streamFor(request), expireAt: Date.now() + 600000 };
  }, {
    current: { ...track('a', '会员歌曲'), source: 'netease', vip: true },
    selectedSource: 'netease',
    qualityPreferences: { netease: 'lossless' },
  });
  await app.emit('music-player', 'error');
  await flushAsyncWork();
  assert.deepEqual(requests.map(({ quality, forceRefresh }) => ({ quality, forceRefresh })), [
    { quality: 'lossless', forceRefresh: false },
    { quality: 'lossless', forceRefresh: true },
  ]);
  assert.equal(audio.currentTime, 42);
  assert.equal(audio.src, 'https://example.test/a-lossless.mp3');
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
  assert.ok(app.element('toast').prepended.length > 0);
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

for (const emptyStream of [null, { url: '' }]) {
  test(`a new track with no URL retains the original display and audio (${JSON.stringify(emptyStream)})`, async () => {
    const { app, audio } = await createPlayingApp((_count, request) =>
      request.track.sourceTrackId === 'b' ? emptyStream : streamFor(request),
    );
    const previousHistory = app.savedState().displayHistory;
    await app.emit('playbackNext', 'click');
    await flushAsyncWork();
    await app.emitWindow('pagehide');

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

test('automatic radio advancement waits for the shared refill after the last candidate fails', async () => {
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
  unavailable.resolve({});
  await flushAsyncWork();
  assert.equal(app.radioRefillRequests(), 1);
  refill.resolve({ tracks: ['c', 'd', 'e', 'f'].map(id => track(id, '补充的可播歌曲')) });
  await flushAsyncWork();

  assert.equal(audio.dataset.trackId, 'c');
  assert.equal(audio.paused, false);
  assert.equal(app.audioPlayCalls(), 2);
  assert.equal(app.radioRefillRequests(), 1);
});

test('automatic radio advancement resumes when an empty queue receives a slow refill', async () => {
  const refill = Promise.withResolvers();
  const { app, audio } = await createPlayingApp((_count, request) => streamFor(request), {
    queueType: 'radio', queueSourceKey: 'qq:radio', currentOrigin: 'radio',
    normalQueue: [], normalQueueTracks: [], radioQueue: [],
  }, { loadHome: () => refill.promise });
  audio.paused = true;
  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  refill.resolve({ tracks: ['b', 'c', 'd', 'e'].map(id => track(id, '新电台歌曲')) });
  await flushAsyncWork();

  assert.equal(audio.dataset.trackId, 'b');
  assert.equal(audio.paused, false);
  assert.equal(app.audioPlayCalls(), 2);
  assert.equal(app.radioRefillRequests(), 1);
});

for (const action of ['pause', 'clear', 'wesing']) {
  test(`late radio refill cannot restart automatic playback after ${action}`, async () => {
    const refill = Promise.withResolvers();
    const { app, audio } = await createPlayingApp((_count, request) => streamFor(request), {
      queueType: 'radio', queueSourceKey: 'qq:radio', currentOrigin: 'radio',
      normalQueue: [], normalQueueTracks: [], radioQueue: [],
    }, { loadHome: () => refill.promise, sourceTabs: ['qq', 'wesing'] });
    audio.paused = true;
    await app.emit('music-player', 'ended');
    await flushAsyncWork();
    const control = action === 'pause' ? 'playbackPlayPause'
      : action === 'clear' ? 'playbackClearQueue' : 'source-tab-wesing';
    await app.emit(control, 'click');
    await flushAsyncWork();
    assert.equal(audio.paused, true);
    const current = app.savedState().current?.id;
    const plays = app.audioPlayCalls();
    refill.resolve({ tracks: [track('b', '迟到的新歌曲')] });
    await flushAsyncWork();

    assert.equal(audio.paused, true);
    assert.equal(app.audioPlayCalls(), plays);
    assert.equal(app.savedState().current?.id, current);
  });
}

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
