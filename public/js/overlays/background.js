import { mountSceneExtraClient } from './scene-extra-client.js';
import { createMoonlitBackground } from './background-moonlit.js';
import { resolveComponentResource } from './component-resources.js';

const image = document.getElementById('backgroundImage');
const video = document.getElementById('backgroundAnimation');
const animation = createMoonlitBackground(video);
let disposed = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animated = new URLSearchParams(location.search).get('style') === 'moonlit-animated';
function update() {
  if (disposed) return;
  animation.update({ animated, reducedMotion: reducedMotion.matches, visible: !document.hidden });
}
function dispose() {
  disposed = true;
  animation.dispose();
  reducedMotion.removeEventListener('change', update);
  document.removeEventListener('visibilitychange', update);
  window.removeEventListener('pagehide', dispose);
}
const component = mountSceneExtraClient('background', {
  async onConfig(config) {
    if (!['none', 'moonlit', 'moonlit-animated'].includes(config?.style)) return false;
    const native = !config.mediaStyle && config.style !== 'none';
    image.hidden = !native;
    if (native) {
      image.src = resolveComponentResource('/img/overlays/backgrounds/moonlit.webp');
      await image.decode();
    } else image.removeAttribute('src');
    animated = !config.mediaStyle && config.style === 'moonlit-animated';
    update();
  },
  onDispose: dispose,
});
reducedMotion.addEventListener('change', update);
document.addEventListener('visibilitychange', update);
window.addEventListener('pagehide', dispose, { once: true });
if (!component && ['moonlit', 'moonlit-animated'].includes(new URLSearchParams(location.search).get('style'))) {
  image.hidden = false;
  image.src = '/img/overlays/backgrounds/moonlit.webp';
  update();
}
