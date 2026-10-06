import { isComponentPreview } from './component-preview-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { createGiftFramePlayer } from './gift-frame-player.js';
import { createGiftFrameQueue } from './gift-frame-queue.js';
import { createGuardThanksQueue } from './gift-effects-guard.js';
import { createMediaEventPlayer } from './component-media.js';

export function mountGiftEffectComponent() {
  if (!isComponentPreview()) return false;
  const frame = new URLSearchParams(location.search).get('giftComponent') === 'frame';
  const type = frame ? 'gift-frame' : 'guard-thanks';
  const frameRoot = document.getElementById('giftFrame');
  const video = frameRoot.querySelector('video');
  const videoSource = video.getAttribute('src');
  const guardRoot = document.getElementById('guardThanksRoot');
  video.removeAttribute('src'); video.load();
  let queue = null;
  let config = {};
  let sample = null;
  let timer;
  let previewSequence = 0;
  let mediaPlayer = null;
  let generation = 0;
  function clear() {
    generation += 1;
    clearTimeout(timer);
    queue?.dispose();
    queue = null;
    mediaPlayer?.stop();
  }
  function dispose() {
    clear();
    mediaPlayer?.dispose();
    mediaPlayer = null;
  }
  function currentMediaPlayer() {
    if (!mediaPlayer && config.mediaStyle) mediaPlayer = createMediaEventPlayer(config.mediaStyle);
    return mediaPlayer;
  }
  function enqueue(payload) {
    if (payload.type !== (frame ? 'gift:frame' : 'gift:guard-thanks')) return;
    if (!queue) {
      const media = currentMediaPlayer();
      // Configuration owns the loaded media; a queue reset only stops playback.
      const player = media ? { play: payload => media.play(payload), dispose: () => media.stop() } : null;
      if (frame && !player) video.setAttribute('src', videoSource);
      queue = frame ? createGiftFrameQueue({ player: player || createGiftFramePlayer({ frameRoot }) })
        : createGuardThanksQueue({ root: guardRoot,
          ...(player ? { player } : {}),
          resolveMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full' });
    }
    queue.enqueue(frame ? payload : { ...payload, textMode: config.textMode });
  }
  function preview() {
    clear();
    for (const payload of sample.events) enqueue({ ...payload, preview: true, eventId: `${payload.eventId}-${++previewSequence}` });
    const current = generation;
    void Promise.resolve(mediaPlayer?.ready()).then(() => {
      if (current !== generation) return;
      const interval = mediaPlayer ? Math.max(3000, mediaPlayer.durationMs * sample.events.length + 1000) : 8000;
      timer = setTimeout(preview, interval);
    }).catch(() => {});
  }
  mountSceneExtraClient(type, {
    onConfig(value) {
      dispose(); config = value;
      if (sample) preview();
      return currentMediaPlayer()?.ready();
    },
    onData(data) {
      sample = data?.preview ? data : null;
      if (sample) { preview(); return; }
      if (!data || data.reset) clear();
      for (const event of data?.events || []) enqueue(event);
    },
    onDispose: dispose,
  });
  return true;
}
