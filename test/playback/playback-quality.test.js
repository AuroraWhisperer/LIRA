'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { closestTarget, createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');

test('quality options survive background updates and still reflect selection and stream fallback', async () => {
  const app = await createPlaybackApp({
    current: track('song', '歌曲'), selectedSource: 'qq', mode: 'sequence', volume: 0.75,
  }, {
    resolveStream: () => ({ url: 'https://example.test/audio.mp3', quality: 'high' }),
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackQualityBtn', 'click', { stopPropagation() {} });
  const panel = app.element('playbackQualityPanel');
  let html = panel.innerHTML;
  let writes = 0;
  Object.defineProperty(panel, 'innerHTML', {
    get: () => html,
    set(value) { writes++; html = value; },
  });

  await app.emit('music-player', 'pause');
  for (let index = 0; index < 20; index++) {
    await app.emitWindow('app:wesing-state', { detail: { currentMs: index * 250, playing: true } });
  }
  assert.equal(writes, 0, 'unchanged options must retain the buttons being focused or clicked');
  assert.equal(panel.getAttribute('aria-hidden'), 'false');

  await app.emit('playbackQualityPanel', 'click', {
    stopPropagation() {}, target: closestTarget({ playbackQuality: 'lossless' }, 'data-playback-quality'),
  });
  assert.equal(writes, 1, 'changing the preference updates the selected option once');
  assert.match(html, /aria-checked="true" data-playback-quality="lossless"/);
  assert.equal(app.savedState().qualityPreferences.qq, 'lossless');
  assert.equal(app.element('playbackQualityLabel').textContent, 'HQ', 'the label still follows actual stream quality');
  assert.deepEqual(app.errors(), []);
});

test('quality options follow provider changes and restore each provider preference', async () => {
  const app = await createPlaybackApp({
    selectedSource: 'qq', mode: 'sequence', volume: 0.75,
    qualityPreferences: { qq: 'lossless', netease: 'exhigh' },
  }, { sourceTabs: ['qq', 'netease', 'wesing'] });
  await app.init();
  await flushAsyncWork();
  const panel = app.element('playbackQualityPanel');
  assert.match(panel.innerHTML, /aria-checked="true" data-playback-quality="lossless"/);
  await app.emit('source-tab-netease', 'click');
  assert.match(panel.innerHTML, /aria-checked="true" data-playback-quality="exhigh"/);
  assert.doesNotMatch(panel.innerHTML, /data-playback-quality="premium"/);
  await app.emit('source-tab-wesing', 'click');
  assert.equal(panel.innerHTML, '');
  await app.emit('source-tab-qq', 'click');
  assert.match(panel.innerHTML, /aria-checked="true" data-playback-quality="lossless"/);
  assert.match(panel.innerHTML, /data-playback-quality="premium"/);
});

for (const action of ['quality', 'recovery']) {
  for (const scenario of [
    { name: 'trial to full', before: 30000, after: 0, position: 5, expected: 35 },
    { name: 'full to trial', before: 0, after: 30000, position: 35, expected: 5 },
    { name: 'changed excerpt', before: 30000, after: 45000, position: 20, expected: 5 },
    { name: 'before the new excerpt', before: 30000, after: 45000, position: 5, expected: 0 },
  ]) {
    test(`NetEase ${action} resumes the same song position (${scenario.name})`, async () => {
      const app = await createPlaybackApp({
        current: { ...track('song', '会员歌曲'), source: 'netease' },
        selectedSource: 'netease', mode: 'sequence', volume: 0.75,
      }, {
        resolveStream: (count, request) => {
          const startMs = count === 1 ? scenario.before : scenario.after;
          return { url: `https://example.test/${count}.mp3`, quality: request.quality,
            expireAt: Date.now() + 600000, trial: startMs > 0, trialStartMs: startMs };
        },
      });
      await app.init();
      await flushAsyncWork();
      await app.emit('playbackPlayPause', 'click');
      const audio = app.element('music-player');
      audio.load = () => { audio.currentTime = 0; };
      audio.currentTime = scenario.position;
      if (action === 'quality') {
        await app.emit('playbackQualityPanel', 'click', {
          stopPropagation() {}, target: closestTarget({ playbackQuality: 'lossless' }, 'data-playback-quality'),
        });
      } else {
        await app.emit('music-player', 'error');
      }
      await flushAsyncWork();
      audio.duration = scenario.after ? 30 : 180;
      await app.emit('music-player', 'loadedmetadata');
      assert.equal(app.resolveStreamRequestCount(), 2);
      assert.equal(audio.currentTime, scenario.expected);
      assert.equal(audio.paused, false);
      assert.equal(app.savedState().current.id, 'song');
    });
  }
}

test('arrow keys focus music sources without selecting them or stopping playback', async () => {
  let queueReads = 0;
  const app = await createPlaybackApp({ current: track('song', '歌曲'), selectedSource: 'netease', mode: 'sequence', volume: 0.75 }, {
    sourceTabs: ['qq', 'netease', 'wesing'],
    songQueue: () => { queueReads++; return { current: null, waiting: [] }; },
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await app.emit('source-tab-netease', 'keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(app.element('source-tab-wesing').focused, true);
  assert.equal(app.element('source-tab-wesing').tabIndex, 0);
  assert.equal(app.savedState().selectedSource, 'netease');
  assert.equal(app.element('music-player').paused, false);
  await app.emit('source-tab-wesing', 'click');
  assert.equal(app.savedState().selectedSource, 'wesing');
  assert.equal(app.element('music-player').paused, true);
  for (const id of ['songQueueImportPlayback', 'playbackImportSongQueue']) assert.equal(app.element(id).disabled, true);
  await app.emit('songQueueImportPlayback', 'click');
  await app.emit('playbackImportSongQueue', 'click');
  assert.equal(queueReads, 0, 'WeSing refuses both import entry points');
  assert.equal(app.savedState().selectedSource, 'wesing');
  await app.emit('source-tab-qq', 'click');
  for (const id of ['songQueueImportPlayback', 'playbackImportSongQueue']) assert.equal(app.element(id).disabled, false);
});

test('source changes preserve an in-flight import lock and finish disabled in WeSing', async () => {
  const pending = Promise.withResolvers();
  const app = await createPlaybackApp({ selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
    sourceTabs: ['qq', 'netease', 'wesing'], songQueue: () => pending.promise,
  });
  await app.init();
  await flushAsyncWork();
  assert.equal(app.element('songQueueImportPlayback').disabled, false);
  const importing = app.emit('songQueueImportPlayback', 'click');
  for (const id of ['songQueueImportPlayback', 'playbackImportSongQueue']) {
    assert.equal(app.element(id).textContent, '导入中…');
    assert.equal(app.element(id).attributes.get('aria-busy'), 'true');
  }
  await app.emit('source-tab-netease', 'click');
  for (const id of ['songQueueImportPlayback', 'playbackImportSongQueue']) {
    assert.equal(app.element(id).disabled, true);
    assert.match(app.element(id).title, /正在.*匹配/);
  }
  await app.emit('source-tab-wesing', 'click');
  pending.resolve({ current: null, waiting: [] });
  await importing;
  for (const id of ['songQueueImportPlayback', 'playbackImportSongQueue']) assert.equal(app.element(id).disabled, true);
  await app.emit('source-tab-qq', 'click');
  for (const [id, label] of [['songQueueImportPlayback', '导入播放器'], ['playbackImportSongQueue', '导入点歌']]) {
    assert.equal(app.element(id).disabled, false);
    assert.equal(app.element(id).textContent, label);
    assert.equal(app.element(id).attributes.get('aria-busy'), 'false');
  }
});

for (const source of ['qq-client', 'netease-client']) {
  test(`following ${source} preserves internal audio, quality changes and playback controls`, async () => {
    const pending = Promise.withResolvers();
    const app = await createPlaybackApp({ current: track('song', '歌曲'), normalQueue: [track('next', '下一首')],
      selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
      sourceTabs: ['qq', 'netease', 'wesing'],
      resolveStream: (count) => count === 1 ? { url: 'https://example.test/original.mp3' } : pending.promise,
    });
    await app.init(); await flushAsyncWork();
    await app.emit('playbackPlayPause', 'click');
    const audio = app.element('music-player');
    const changing = app.emit('playbackQualityPanel', 'click', {
      stopPropagation() {}, target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
    });
    await flushAsyncWork();
    await app.emitWindow('app:lyric-source', { detail: { source, selection: 'auto' } });
    assert.equal(audio.paused, false, 'lyric following does not stop audio');
    pending.resolve({ url: 'https://example.test/high.mp3' });
    await changing; await flushAsyncWork();
    assert.equal(audio.src, 'https://example.test/high.mp3');
    assert.equal(app.audioPlayCalls(), 2, 'output changes do not cancel internal stream requests');
    await app.emit('playbackPlayPause', 'click');
    assert.equal(audio.paused, true);
    await app.emit('playbackPlayPause', 'click');
    assert.equal(audio.paused, false);
    await app.emit('music-player', 'ended');
    await flushAsyncWork();
    assert.equal(app.savedState().current.id, 'next', 'automatic next remains available');
    await app.emit('source-tab-netease', 'click');
    assert.equal(app.savedState().selectedSource, 'netease', 'provider navigation does not require an output change');
    assert.deepEqual(app.errors(), []);
  });
}

for (const pauseThenResume of [false, true]) {
  test(`quality loading respects a later pause${pauseThenResume ? ' and resume' : ''}`, async () => {
    const pending = Promise.withResolvers();
    const app = await createPlaybackApp({ current: track('song', '歌曲'), selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
      resolveStream: (count) => count === 1 ? { url: 'https://example.test/original.mp3' } : pending.promise,
    });
    await app.init();
    await flushAsyncWork();
    await app.emit('playbackPlayPause', 'click');
    const audio = app.element('music-player');
    audio.currentTime = 47;
    const changing = app.emit('playbackQualityPanel', 'click', {
      stopPropagation() {},
      target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
    });
    await flushAsyncWork();
    await app.emit('playbackPlayPause', 'click');
    if (pauseThenResume) await app.emit('playbackPlayPause', 'click');
    pending.resolve({ url: 'https://example.test/high.mp3', quality: 'high' });
    await changing;
    await app.emit('music-player', 'loadedmetadata');
    assert.equal(audio.src, 'https://example.test/high.mp3');
    assert.equal(audio.currentTime, 47);
    assert.equal(audio.paused, !pauseThenResume);
    assert.equal(app.audioPlayCalls(), pauseThenResume ? 3 : 1);
    assert.equal(app.savedState().qualityPreferences.qq, 'high');
  });
}

for (const operation of ['play', 'quality']) {
  for (const source of ['wesing', 'netease']) {
    test(`switching to ${source} while ${operation} resolves respects source playback ownership`, async () => {
      const pending = Promise.withResolvers();
      const app = await createPlaybackApp({ current: track('song', '歌曲'), selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
        sourceTabs: ['qq', 'netease', 'wesing'],
        resolveStream: (count) => operation === 'quality' && count === 1
          ? { url: 'https://example.test/original.mp3' } : pending.promise,
      });
      await app.init();
      await flushAsyncWork();
      if (operation === 'quality') await app.emit('playbackPlayPause', 'click');
      const loading = operation === 'play' ? app.emit('playbackPlayPause', 'click')
        : app.emit('playbackQualityPanel', 'click', {
          stopPropagation() {},
          target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
        });
      await flushAsyncWork();
      const playCalls = app.audioPlayCalls();
      await app.emit(`source-tab-${source}`, 'click');
      pending.resolve({ url: 'https://example.test/resolved.mp3', quality: 'high' });
      await loading;
      await flushAsyncWork();
      assert.equal(app.savedState().selectedSource, source);
      assert.equal(app.element('music-player').paused, source === 'wesing');
      assert.equal(app.audioPlayCalls(), playCalls + (source === 'wesing' ? 0 : 1));
      if (source === 'wesing') {
        const suspendedRequests = app.resolveStreamRequestCount();
        await app.emit('music-player', 'error');
        await flushAsyncWork();
        assert.equal(app.resolveStreamRequestCount(), suspendedRequests, 'WeSing owns playback until the source is left');
        await app.emit('source-tab-qq', 'click');
        await app.emit('playbackPlayPause', 'click');
        assert.equal(app.element('music-player').paused, false, 'leaving WeSing permits explicit online playback');
        const requests = app.resolveStreamRequestCount();
        await app.emit('music-player', 'error');
        await flushAsyncWork();
        assert.ok(app.resolveStreamRequestCount() > requests, 'retained online audio can recover after leaving WeSing');
        assert.equal(app.element('music-player').paused, false);
      }
      assert.deepEqual(app.errors(), []);
    });
  }
}

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
    target: closestTarget({ playbackQuality: 'lossless' }, 'data-playback-quality'),
  });
  await app.emit('music-player', 'loadedmetadata');
  await app.emitWindow('pagehide');

  assert.equal(requestBody.quality, 'lossless');
  assert.equal(requestBody.track.sourceTrackId, 'quality-song');
  assert.equal(requestBody.track.sourceSongType, 1);
  assert.equal(app.element('music-player').src, 'https://example.test/high.mp3');
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
    target: closestTarget({ playbackQuality: 'lossless' }, 'data-playback-quality'),
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
    target: closestTarget({ playbackQuality: 'premium' }, 'data-playback-quality'),
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
        if (requestBody.track.sourceTrackId === current.sourceTrackId && requestBody.quality === 'lossless') {
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
    target: closestTarget({ playbackQuality: 'lossless' }, 'data-playback-quality'),
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
