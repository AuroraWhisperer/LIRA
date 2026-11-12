import { isComponentPreview } from './component-preview-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { createGiftFramePlayer } from './gift-frame-player.js';
import { FRAME_DURATION_MS } from './gift-effects-frame.js';
import { createGiftFrameQueue } from './gift-frame-queue.js';
import { createGuardThanksQueue } from './gift-effects-guard.js';
import { createMediaEventPlayer } from './component-media.js';
import { createNauticalGuardPlayer } from './guard-nautical-player.js';
import { resolveComponentResource } from './component-resources.js';
import { WOODLAND_GIFT_VIDEO } from '../shared/component-resource-style.js';
import { createGiftMotionPlayer } from './gift-motion-player.js';
import { createGiftMotionSamples } from '../shared/gift-motion-samples.js';
import { GIFT_DROP_SPAWN_DELAY_MS, GIFT_DROP_EXIT_MS } from '../shared/gift-drop-physics.js';
import { isGiftFrameEventForLayer } from '../shared/gift-frame-style-triggers.js';

export function mountGiftEffectComponent() {
  if (!isComponentPreview()) return false;
  const frame = new URLSearchParams(location.search).get('giftComponent') === 'frame';
  const type = frame ? 'gift-frame' : 'guard-thanks';
  const frameRoot = document.getElementById('giftFrame');
  const video = frameRoot.querySelector('video');
  const guardRoot = document.getElementById('guardThanksRoot');
  video.removeAttribute('src'); video.load();
  let queue = null;
  let config = {};
  let sample = null;
  let timer;
  let previewSequence = 0;
  let mediaPlayer = null;
  let generation = 0;
  let motionPlayer = null;
  const sampleTimers = new Set();
  function clear() {
    generation += 1;
    clearTimeout(timer);
    queue?.dispose();
    queue = null;
    mediaPlayer?.stop();
    motionPlayer?.dispose(); motionPlayer = null;
    for (const task of sampleTimers) clearTimeout(task);
    sampleTimers.clear();
  }
  function dispose() {
    clear();
    mediaPlayer?.dispose();
    mediaPlayer = null;
  }
  function currentMediaPlayer() {
    if (!mediaPlayer && !frame && config.resourceStyle?.preset === 'nautical-guard-thanks') {
      mediaPlayer = createNauticalGuardPlayer({ root: guardRoot, config });
    }
    if (!mediaPlayer && config.mediaStyle) mediaPlayer = createMediaEventPlayer(config.mediaStyle);
    return mediaPlayer;
  }
  function enqueue(payload) {
    if (payload.type !== (frame ? 'gift:frame' : 'gift:guard-thanks')) return;
    const motion = ['gift-drop', 'gift-swing'].includes(payload.themeId);
    if (frame && motion) {
      if (config.mediaStyle || config.resourceStyle || !['follow', payload.themeId].includes(config.style || 'follow')) return;
      motionPlayer ??= createGiftMotionPlayer({ root: document.getElementById('giftMotionRoot') });
      motionPlayer.enqueue(payload); return;
    }
    if (frame && ['gift-drop', 'gift-swing'].includes(config.style)) return;
    if (frame && !isGiftFrameEventForLayer(config, payload)) return;
    const nautical = config.resourceStyle?.preset === 'nautical-guard-thanks';
    if (!payload.preview && !frame && nautical !== (payload.style === 'nautical')) return;
    if (!frame && !config.mediaStyle && !config.resourceStyle && ['aurora', 'classic'].includes(config.style)) {
      if (!payload.preview && (payload.style || 'aurora') !== config.style) return;
      payload = { ...payload, style: config.style };
    }
    if (!queue) {
      const media = currentMediaPlayer();
      // Configuration owns the loaded media; a queue reset only stops playback.
      const player = media ? { play: payload => media.play(payload), dispose: () => media.stop() } : null;
      queue = frame ? createGiftFrameQueue({ player: player || createGiftFramePlayer({ frameRoot,
        source: resolveComponentResource(WOODLAND_GIFT_VIDEO) }) })
        : createGuardThanksQueue({ root: guardRoot,
          ...(player ? { player } : {}),
          resolveMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full' });
    }
    queue.enqueue(frame || !config.textMode || config.textMode === 'follow'
      ? payload : { ...payload, textMode: config.textMode });
  }
  function preview() {
    clear();
    const motion = frame && ['gift-drop', 'gift-swing'].includes(config.style) && !config.mediaStyle && !config.resourceStyle;
    const drop = motion && config.style === 'gift-drop';
    const startedAt = Date.now();
    const events = motion ? sample.events.some(event => event.themeId === config.style)
      ? sample.events.filter(event => event.themeId === config.style) : createGiftMotionSamples(config.style) : sample.events;
    events.forEach((payload, index) => {
      const play = () => enqueue({ ...payload, preview: true, startedAt: drop ? startedAt : Date.now(), eventId: `${payload.eventId}-${++previewSequence}` });
      if (!motion || drop || index === 0) play();
      else {
        const task = setTimeout(() => { sampleTimers.delete(task); play(); }, index * 1500);
        sampleTimers.add(task);
      }
    });
    const current = generation;
    void Promise.resolve(mediaPlayer?.ready()).then(() => {
      if (current !== generation) return;
      const interval = mediaPlayer ? Math.max(3000, mediaPlayer.durationMs * sample.events.length + 1000)
        : motion ? Math.max(...events.map(event => (event.motion?.durationSeconds || 20) * 1000))
          + (drop ? GIFT_DROP_SPAWN_DELAY_MS + GIFT_DROP_EXIT_MS : events.length * 1500) + 1000
          : frame ? FRAME_DURATION_MS * sample.events.length + 1500 : 8000;
      timer = setTimeout(preview, interval);
    }).catch(() => {});
  }
  mountSceneExtraClient(type, {
    onConfig(value) {
      if (mediaPlayer && !frame && config.resourceStyle?.preset === 'nautical-guard-thanks'
        && JSON.stringify(config.resourceStyle) === JSON.stringify(value.resourceStyle)) {
        config = value;
        mediaPlayer.configure(value);
        return mediaPlayer.ready();
      }
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
