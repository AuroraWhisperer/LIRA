'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  closestTarget,
  createPlaybackApp,
  flushAsyncWork,
  track,
} = require('./helpers/playback-app');

async function createPlayingApp(pending, { currentSource = 'qq', nextSource = 'qq' } = {}) {
  const current = { ...track('a', '歌曲 A'), source: currentSource };
  const next = { ...track('b', '歌曲 B'), source: nextSource };
  const app = await createPlaybackApp({
    current,
    currentOrigin: 'normal',
    normalQueue: [next],
    normalQueueTracks: [current, next],
    mode: 'sequence',
    volume: 0.75,
    selectedSource: 'qq',
    queueType: 'queue',
  }, {
    authState: { platform: 'qq', loggedIn: true },
    resolveStream: (count, request) => count === 1
      ? { url: 'https://example.test/a.mp3', quality: request.quality }
      : pending.promise,
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  return app;
}

for (const action of ['next', 'quality', 'recovery']) {
  for (const result of ['success', 'failure']) {
    test(`logout invalidates pending ${action} (${result})`, async () => {
      const pending = Promise.withResolvers();
      const app = await createPlayingApp(pending);
      let request;
      if (action === 'next') {
        request = app.emit('playbackNext', 'click');
      } else if (action === 'quality') {
        request = app.emit('playbackQualityPanel', 'click', {
          stopPropagation() {},
          target: closestTarget({ playbackQuality: 'high' }, 'data-playback-quality'),
        });
      } else {
        request = app.emit('music-player', 'error');
      }
      await flushAsyncWork();
      assert.equal(app.resolveStreamRequestCount(), 2);
      await app.emit('playbackLogoutBtn', 'click');
      const audio = app.element('music-player');
      const toasts = app.element('toast').prepended.map((item) => item.textContent);
      assert.equal(app.savedState().current, null);
      assert.equal(audio.src, '');

      if (result === 'success') pending.resolve({ url: 'https://example.test/late.mp3' });
      else pending.reject(new Error('stale playback failure'));
      await request;
      await flushAsyncWork();

      assert.deepEqual(app.errors(), []);
      assert.equal(app.savedState().current, null);
      assert.equal(audio.src, '');
      assert.equal(audio.paused, true);
      assert.equal(app.audioPlayCalls(), 1);
      assert.deepEqual(app.element('toast').prepended.map((item) => item.textContent), toasts);
    });
  }
}

test('logout cancels that provider even while another provider is the current track', async () => {
  const pending = Promise.withResolvers();
  const app = await createPlayingApp(pending, { currentSource: 'netease' });
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  await app.emit('playbackLogoutBtn', 'click');
  pending.resolve({ url: 'https://example.test/late-qq.mp3' });
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'a');
  assert.equal(app.element('music-player').src, 'https://example.test/a.mp3');
  assert.equal(app.audioPlayCalls(), 1);
  await app.emit('music-player', 'error');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'a');
  assert.equal(app.audioPlayCalls(), 2, 'the retained provider can still recover its audio');
});

test('logout allows an already pending request for another provider to complete', async () => {
  const pending = Promise.withResolvers();
  const app = await createPlayingApp(pending, { nextSource: 'netease' });
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  await app.emit('playbackLogoutBtn', 'click');
  pending.resolve({ url: 'https://example.test/netease.mp3' });
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'b');
  assert.equal(app.element('music-player').paused, false);
  assert.equal(app.audioPlayCalls(), 2);
});
