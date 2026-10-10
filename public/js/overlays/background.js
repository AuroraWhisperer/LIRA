import { mountSceneExtraClient } from './scene-extra-client.js';
import { createMoonlitBackground } from './background-moonlit.js';
import { createWindowlightBackground } from './background-windowlight.js';
import { resolveComponentResource } from './component-resources.js';
import { getBackgroundAppearance } from '../shared/background-appearance.js';
import { createBackgroundFilters } from './background-filters.js';

const image = document.getElementById('backgroundImage');
const video = document.getElementById('backgroundAnimation');
const animation = createMoonlitBackground(video);
const windowlight = createWindowlightBackground(document.getElementById('windowlightBackground'));
const filters = createBackgroundFilters(document);
let disposed = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animated = new URLSearchParams(location.search).get('style') === 'moonlit-animated';
let currentConfig = {};
let configuration = 0;
function update() {
  if (disposed) return;
  animation.update({ animated, reducedMotion: reducedMotion.matches, visible: !document.hidden });
  return windowlight.update(currentConfig, { reducedMotion: reducedMotion.matches, visible: !document.hidden });
}
function updateVisibility() { update()?.catch(() => {}); }
function dispose() {
  disposed = true;
  animation.dispose();
  windowlight.dispose();
  filters.dispose();
  reducedMotion.removeEventListener('change', updateVisibility);
  document.removeEventListener('visibilitychange', updateVisibility);
  window.removeEventListener('pagehide', dispose);
}
const component = mountSceneExtraClient('background', {
  async onConfig(config) {
    if (!['none', 'moonlit', 'moonlit-animated', 'windowlight'].includes(config?.style)) return false;
    const current = ++configuration;
    currentConfig = config;
    const appearance = getBackgroundAppearance(config);
    const root = document.body;
    root.style.opacity = appearance.opacity;
    root.style.setProperty('--background-fit', appearance.fit);
    const basicFilter = appearance.blur || appearance.brightness !== 1 || appearance.saturation !== 1 || appearance.contrast !== 1
      ? `blur(${appearance.blur}px) brightness(${appearance.brightness}) saturate(${appearance.saturation}) contrast(${appearance.contrast})` : '';
    root.style.setProperty('--background-filter', [basicFilter, filters.build(appearance)].filter(Boolean).join(' ') || 'none');
    root.style.setProperty('--background-bleed', `${appearance.fit === 'contain' ? 0 : appearance.blur * 3}px`);
    root.style.setProperty('--background-overlay-color', appearance.overlayColor);
    root.style.setProperty('--background-overlay-opacity', config.mediaStyle || config.style !== 'none' ? appearance.overlayOpacity : 0);
    for (const element of root.querySelectorAll('video')) {
      element.defaultPlaybackRate = appearance.playbackRate;
      element.playbackRate = appearance.playbackRate;
      element.volume = appearance.volume;
      element.muted = appearance.volume === 0;
    }
    const native = !config.mediaStyle && ['moonlit', 'moonlit-animated'].includes(config.style);
    image.hidden = !native;
    if (native) {
      const source = resolveComponentResource('/img/overlays/backgrounds/moonlit.webp');
      if (image.getAttribute('src') !== source) image.src = source;
      if (!image.complete || !image.naturalWidth) await image.decode();
    } else image.removeAttribute('src');
    if (disposed || current !== configuration) return;
    animated = !config.mediaStyle && config.style === 'moonlit-animated';
    await update();
  },
  onDispose: dispose,
});
reducedMotion.addEventListener('change', updateVisibility);
document.addEventListener('visibilitychange', updateVisibility);
window.addEventListener('pagehide', dispose, { once: true });
if (!component && ['moonlit', 'moonlit-animated'].includes(new URLSearchParams(location.search).get('style'))) {
  image.hidden = false;
  image.src = '/img/overlays/backgrounds/moonlit.webp';
  update();
}
