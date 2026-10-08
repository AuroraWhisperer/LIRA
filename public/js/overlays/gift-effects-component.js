import { isComponentPreview } from './component-preview-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { createGiftFramePlayer } from './gift-frame-player.js';
import { FRAME_DURATION_MS } from './gift-effects-frame.js';
import { createGiftFrameQueue } from './gift-frame-queue.js';
import { createGuardThanksQueue } from './gift-effects-guard.js';
import { createMediaEventPlayer } from './component-media.js';
import { createNauticalGuardPlayer } from './guard-nautical-player.js';

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
    if (!mediaPlayer && !frame && config.resourceStyle?.preset === 'nautical-guard-thanks') {
      mediaPlayer = createNauticalGuardPlayer({ root: guardRoot });
    }
    if (!mediaPlayer && config.mediaStyle) mediaPlayer = createMediaEventPlayer(config.mediaStyle);
    return mediaPlayer;
  }
  function enqueue(payload) {
    if (payload.type !== (frame ? 'gift:frame' : 'gift:guard-thanks')) return;
    if (!frame && !config.mediaStyle && !config.resourceStyle && ['aurora', 'classic'].includes(config.style)) {
      if (!payload.preview && (payload.style || 'aurora') !== config.style) return;
      payload = { ...payload, style: config.style };
    }
    if (config.resourceStyle?.preset === 'nautical-guard-thanks' && !payload.preview) {
      // Both native styles may emit for one purchase; this artwork plays that purchase once.
      payload = { ...payload, eventId: payload.eventId?.replace(/^guard-thanks:(\d+):(?:aurora|classic)$/, 'guard-thanks:$1') };
    }
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
    queue.enqueue(frame || !config.textMode || config.textMode === 'follow'
      ? payload : { ...payload, textMode: config.textMode });
  }
  function preview() {
    clear();
    for (const payload of sample.events) enqueue({ ...payload, preview: true, eventId: `${payload.eventId}-${++previewSequence}` });
    const current = generation;
    void Promise.resolve(mediaPlayer?.ready()).then(() => {
      if (current !== generation) return;
      const interval = mediaPlayer ? Math.max(3000, mediaPlayer.durationMs * sample.events.length + 1000)
        : frame ? FRAME_DURATION_MS * sample.events.length + 1500 : 8000;
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
