import { createComponentStyleEffects } from '../overlays/component-style-effects.js';
import { styleParametersFor } from './component-style-parameters.js';
import { normalizeBrowserSourceConfig } from './scene-browser-source.js';

const frameEffects = new WeakMap();

export function disposeBrowserSourceFrame(frame) {
  frameEffects.get(frame)?.dispose();
  frameEffects.delete(frame);
}

export function configureBrowserSourceFrame(frame, config, displayWidth, displayHeight) {
  const { url, viewportWidth, viewportHeight } = normalizeBrowserSourceConfig(config, { allowEmptyUrl: true });
  disposeBrowserSourceFrame(frame);
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.style.width = `${viewportWidth}px`;
  frame.style.height = `${viewportHeight}px`;
  frame.style.transformOrigin = '0 0';
  frame.style.transform = `scale(${displayWidth / viewportWidth}, ${displayHeight / viewportHeight})`;
  if (Object.keys(styleParametersFor(config)).length) {
    const effects = createComponentStyleEffects(frame.ownerDocument, { externalFrame: frame });
    frameEffects.set(frame, effects);
    effects.update('browser', config);
  }
  const source = url || 'about:blank';
  if (frame.getAttribute('src') !== source) frame.src = source;
}
