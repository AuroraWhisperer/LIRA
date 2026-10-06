import { normalizeBrowserSourceConfig } from './scene-browser-source.js';

export function configureBrowserSourceFrame(frame, config, displayWidth, displayHeight) {
  const { url, viewportWidth, viewportHeight } = normalizeBrowserSourceConfig(config, { allowEmptyUrl: true });
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.style.width = `${viewportWidth}px`;
  frame.style.height = `${viewportHeight}px`;
  frame.style.transformOrigin = '0 0';
  frame.style.transform = `scale(${displayWidth / viewportWidth}, ${displayHeight / viewportHeight})`;
  const source = url || 'about:blank';
  if (frame.getAttribute('src') !== source) frame.src = source;
}
