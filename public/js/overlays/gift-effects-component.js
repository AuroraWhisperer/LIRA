import { isComponentPreview } from './component-preview-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { createGiftFramePlayer } from './gift-frame-player.js';
import { createGiftFrameQueue } from './gift-frame-queue.js';
import { createGuardThanksQueue } from './gift-effects-guard.js';

export function mountGiftEffectComponent() {
  if (!isComponentPreview()) return false;
  const frame = new URLSearchParams(location.search).get('giftComponent') === 'frame';
  const type = frame ? 'gift-frame' : 'guard-thanks';
  const frameRoot = document.getElementById('giftFrame');
  const ribbonRoot = document.getElementById('giftRibbon');
  const video = frameRoot.querySelector('video');
  const videoSource = video.getAttribute('src');
  const guardRoot = document.getElementById('guardThanksRoot');
  if (!frame) { video.removeAttribute('src'); video.load(); }
  let queue = null;
  let config = {};
  let sample = null;
  let timer;
  let previewSequence = 0;
  function clear() {
    clearTimeout(timer);
    queue?.dispose();
    queue = null;
  }
  function enqueue(payload) {
    if (payload.type !== (frame ? 'gift:frame' : 'gift:guard-thanks')) return;
    if (!queue) {
      if (frame) video.setAttribute('src', videoSource);
      queue = frame ? createGiftFrameQueue({ player: createGiftFramePlayer({ frameRoot, ribbonRoot }) })
        : createGuardThanksQueue({ root: guardRoot,
          resolveMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full' });
    }
    queue.enqueue(frame ? payload : { ...payload, textMode: config.textMode });
  }
  function preview() {
    clear();
    for (const payload of sample.events) enqueue({ ...payload, preview: true, eventId: `${payload.eventId}-${++previewSequence}` });
    timer = setTimeout(preview, 8000);
  }
  mountSceneExtraClient(type, {
    onConfig(value) { config = value; if (sample) preview(); },
    onData(data) {
      sample = data?.preview ? data : null;
      if (sample) { preview(); return; }
      if (!data || data.reset) clear();
      for (const event of data?.events || []) enqueue(event);
    },
    onDispose: clear,
  });
  return true;
}
