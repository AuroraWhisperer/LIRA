import { normalizeMediaStyle, formatMediaThanks } from '../shared/component-media-style.js';

function stylesheet() {
  if (document.querySelector('link[data-component-media]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/css/overlays/component-media.css'; link.dataset.componentMedia = '';
  document.head.append(link);
}

export function createMediaElement(style, { loop = false } = {}) {
  const element = document.createElement(style.kind === 'video' ? 'video' : 'img');
  element.className = 'component-media-art';
  if (style.kind === 'video') {
    element.playsInline = true; element.loop = loop; element.muted = style.volume === 0; element.volume = style.volume;
    element.preload = 'auto';
  } else element.alt = '';
  element.src = style.src;
  return element;
}

export function setMediaContentArea(element, style) {
  const { x, y, width, height } = style.content;
  Object.assign(element.style, { left: `${x}%`, top: `${y}%`, width: `${width}%`, height: `${height}%`,
    color: style.textColor, fontSize: `${style.fontSize}px` });
}

function waitForMedia(element, signal) {
  if (signal.aborted) return Promise.resolve();
  if (element.tagName === 'IMG' && element.complete) return element.naturalWidth
    ? Promise.resolve() : Promise.reject(new Error('素材无法读取。'));
  if (element.tagName === 'VIDEO' && element.readyState >= 2) return Promise.resolve();
  if (element.error) return Promise.reject(new Error('素材无法播放。'));
  return new Promise((resolve, reject) => {
    const loadedEvent = element.tagName === 'IMG' ? 'load' : 'loadeddata';
    const loaded = () => finish();
    const failed = () => finish(new Error('素材无法播放。'));
    const timer = setTimeout(() => finish(new Error('素材加载超时。')), 9000);
    function finish(error) {
      clearTimeout(timer);
      element.removeEventListener(loadedEvent, loaded); element.removeEventListener('error', failed);
      signal.removeEventListener('abort', loaded);
      if (error) reject(error); else resolve();
    }
    element.addEventListener(loadedEvent, loaded, { once: true }); element.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', loaded, { once: true });
  });
}

export function createMediaDecoration() {
  const targets = { '/clock': ['clock', '.clock-stage'], '/danmaku': ['danmaku', '#danmakuCanvasHost'],
    '/gift-wishes': ['gift-wishes', '#giftWishStage'], '/background': ['background', null] };
  const target = targets[location.pathname];
  let art;
  let source;
  let content;
  let loading;
  function clear() {
    if (!art) return;
    loading?.abort();
    if (art?.tagName === 'VIDEO') { art.pause(); art.removeAttribute('src'); art.load(); }
    art?.remove(); art = null; source = null;
    content?.classList.remove('component-media-content');
    if (content) for (const name of ['left', 'top', 'width', 'height', 'color', 'font-size']) content.style.removeProperty(name);
    delete document.documentElement.dataset.mediaStyle;
  }
  return {
    update(config) {
      if (!target || !config?.mediaStyle) { if (art) clear(); return; }
      const style = normalizeMediaStyle(target[0], config.mediaStyle);
      stylesheet();
      document.documentElement.dataset.mediaStyle = target[0];
      document.documentElement.style.setProperty('--media-text-color', style.textColor);
      document.documentElement.style.setProperty('--media-font-size', `${style.fontSize}px`);
      if (source !== style.src) {
        if (art) clear();
        document.documentElement.dataset.mediaStyle = target[0];
        art = createMediaElement(style, { loop: true }); source = style.src;
        loading = new AbortController();
        document.body.prepend(art);
        if (style.kind === 'video') void art.play().catch(() => { art.muted = true; void art.play().catch(() => { art.dataset.playbackFailed = 'true'; }); });
      }
      if (art.tagName === 'VIDEO') { art.volume = style.volume; art.muted = style.volume === 0; }
      content = target[1] ? document.querySelector(target[1]) : null;
      if (content) { content.classList.add('component-media-content'); setMediaContentArea(content, style); }
    },
    async ready() {
      if (!art) return;
      await waitForMedia(art, loading.signal);
    },
    dispose: clear,
  };
}

export function createMediaEventPlayer(style) {
  stylesheet();
  const root = document.createElement('div'); root.className = 'component-media-playback'; root.hidden = true;
  const media = createMediaElement(style);
  const text = document.createElement('div'); text.className = 'component-media-thanks';
  setMediaContentArea(text, style);
  root.append(media, text); document.body.append(root);
  let finish;
  let disposed = false;
  const loading = new AbortController();
  let readiness;
  const ready = () => readiness ??= waitForMedia(media, loading.signal);
  const duration = () => style.kind === 'video' && Number.isFinite(media.duration)
    ? Math.min(style.durationMs, Math.max(250, media.duration * 1000)) : style.durationMs;
  return {
    ready,
    get durationMs() { return duration(); },
    play(payload = {}) {
      if (disposed) return Promise.resolve();
      finish?.();
      return new Promise(resolve => {
        let timer; let textTimer; let completed = false;
        finish = () => {
          if (completed) return;
          completed = true;
          clearTimeout(timer); clearTimeout(textTimer); root.hidden = true;
          media.removeEventListener('ended', finishPlayback); media.removeEventListener('error', finishPlayback);
          if (style.kind === 'video') media.pause();
          finish = null; resolve();
        };
        const finishPlayback = finish;
        void ready().then(() => {
          if (disposed || finish !== finishPlayback) return;
          text.textContent = formatMediaThanks(style.textTemplate, payload);
          text.hidden = !style.showText || style.textDelayMs > 0;
          if (style.showText && style.textDelayMs > 0) textTimer = setTimeout(() => { text.hidden = false; }, style.textDelayMs);
          root.hidden = false;
          timer = setTimeout(finishPlayback, duration());
          if (style.kind === 'video') {
            media.currentTime = 0;
            media.addEventListener('ended', finishPlayback, { once: true });
            media.addEventListener('error', finishPlayback, { once: true });
            void media.play().catch(error => {
              if (disposed || finish !== finishPlayback) return;
              if (error.name !== 'NotAllowedError') { finishPlayback(); return; }
              media.muted = true;
              void media.play().catch(finishPlayback);
            });
          }
        }).catch(finishPlayback);
      });
    },
    stop() { finish?.(); },
    dispose() {
      disposed = true; finish?.(); loading.abort();
      if (style.kind === 'video') { media.removeAttribute('src'); media.load(); }
      root.remove();
    },
  };
}
