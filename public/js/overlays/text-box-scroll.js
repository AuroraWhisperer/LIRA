import { renderTextBox } from '../shared/text-box-renderer.js';
import { normalizeTextBoxConfig, TEXT_BOX_SIZE } from '../shared/text-box-config.js';

const SPEED = 40;

export function createTextBoxPlayback(host) {
  const document = host.ownerDocument;
  const view = document.defaultView;
  let mode = 'none';
  let signature = '';
  let content = null;
  let frame = null;
  let previousTime = null;
  let position = 0;
  let distance = 0;
  let hasContent = false;
  let disposed = false;
  const observer = new view.ResizeObserver(measure);

  function stop() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
  }

  function tick(time) {
    if (previousTime !== null) position = (position + (time - previousTime) * SPEED / 1000) % distance;
    previousTime = time;
    if (mode === 'horizontal') host.scrollLeft = position;
    else host.scrollTop = position;
    frame = view.requestAnimationFrame(tick);
  }

  function resume() {
    if (!disposed && !document.hidden && mode !== 'none' && distance > 0 && frame === null) {
      frame = view.requestAnimationFrame(tick);
    }
  }

  function measure() {
    if (disposed || !content || !hasContent) return;
    // Native scrolling clips a single copy of the text; no full-length animated texture.
    // Layout reads happen here, never in the animation callback.
    distance = mode === 'horizontal' ? host.scrollWidth - host.clientWidth : host.scrollHeight - host.clientHeight;
    position = distance > 0 ? position % distance : 0;
    if (distance <= 0) stop();
    else resume();
  }

  function resize() {
    const scale = view.innerWidth / TEXT_BOX_SIZE[0];
    if (disposed || scale <= 0) return;
    host.style.transform = `scale(${scale})`;
    host.style.height = `${view.innerHeight / scale}px`;
    host.style.setProperty('--text-box-viewport-height', `${view.innerHeight / scale}px`);
    measure();
  }

  function visibility() {
    if (document.hidden) stop();
    else resume();
  }
  view.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);

  return {
    update(input) {
      if (disposed) return;
      const config = normalizeTextBoxConfig(input);
      const next = JSON.stringify(config);
      if (next === signature) return;
      signature = next;
      stop(); observer.disconnect();
      content = null; distance = 0;
      mode = config.scrollMode;
      hasContent = config.nodes.some(node => node.type !== 'text' || node.text.trim());
      host.dataset.scrollMode = mode;
      host.scrollLeft = host.scrollTop = 0;
      if (mode === 'none') {
        renderTextBox(host, config);
      } else {
        const track = document.createElement('div');
        track.className = 'text-box-scroll-track';
        content = document.createElement('div');
        renderTextBox(content, config, { singleLine: mode === 'horizontal' });
        track.append(content);
        host.replaceChildren(track);
        observer.observe(content);
      }
      resize();
      // Start with the text visible. Both ends have one empty viewport, so the
      // wrap happens entirely offscreen without cloning long text or GIFs.
      position = mode === 'horizontal' ? host.clientWidth : host.clientHeight;
      host.scrollLeft = mode === 'horizontal' ? position : 0;
      host.scrollTop = mode === 'vertical' ? position : 0;
    },
    dispose() {
      disposed = true;
      stop(); observer.disconnect();
      view.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      host.replaceChildren();
    },
  };
}
