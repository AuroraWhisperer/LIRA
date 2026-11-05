import { NOW_PLAYING_DEFAULTS } from './now-playing-appearance.js';
import { withMultilingualFallback } from './utils.js';

export function createNowPlayingRenderer(root) {
  const document = root.ownerDocument;
  const element = (tag, className) => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  const surface = element('div', 'now-playing');
  surface.setAttribute('role', 'group');
  surface.setAttribute('aria-label', '歌曲信息');
  const visual = element('div', 'now-playing-visual');
  visual.setAttribute('aria-hidden', 'true');
  const disc = element('div', 'now-playing-disc');
  const artwork = element('div', 'now-playing-artwork');
  disc.append(artwork, element('span', 'now-playing-spindle'));
  visual.append(disc, element('span', 'now-playing-tonearm'));
  const copy = element('div', 'now-playing-copy');
  copy.setAttribute('aria-live', 'polite');
  const title = element('div', 'now-playing-title');
  const artist = element('div', 'now-playing-artist');
  title.setAttribute('dir', 'auto');
  artist.setAttribute('dir', 'auto');
  copy.append(title, artist);
  surface.append(visual, copy);
  root.classList.add('now-playing-surface');
  root.replaceChildren(surface);

  let config = { ...NOW_PLAYING_DEFAULTS };
  let state = {};
  let imageRequest = null;
  let artworkKey = '';
  let visible = true;
  let disposed = false;
  const enabled = (value) => value === true || value === 'true';

  function updateMotion() {
    const playing = state.playing === true && Boolean(state.trackTitle);
    surface.dataset.playing = String(playing);
    disc.style.animationPlayState = playing && enabled(config.nowPlayingRotation)
      && !visual.hidden && !surface.hidden && !document.hidden && visible ? 'running' : 'paused';
  }

  function renderVisibility() {
    const hasTrack = Boolean(state.trackTitle);
    visual.hidden = !enabled(config.nowPlayingShowRecord);
    title.hidden = !enabled(config.nowPlayingShowTitle);
    artist.hidden = !enabled(config.nowPlayingShowArtist) || !artist.textContent;
    copy.hidden = title.hidden && artist.hidden;
    surface.dataset.recordOnly = String(copy.hidden);
    surface.hidden = !hasTrack && enabled(config.nowPlayingHideWhenEmpty)
      || hasTrack && state.playing !== true && enabled(config.nowPlayingHideOnPause)
      || visual.hidden && copy.hidden;
    updateMotion();
  }

  function discardImage() {
    if (imageRequest) {
      imageRequest.onload = imageRequest.onerror = null;
      imageRequest.removeAttribute('src');
      imageRequest = null;
    }
    artwork.replaceChildren();
  }

  function updateArtwork() {
    const key = JSON.stringify([state.source, state.trackTitle, state.artists, state.coverUrl]);
    if (key === artworkKey) return;
    artworkKey = key;
    discardImage();
    if (!state.trackTitle || !state.coverUrl) return;
    let source;
    try {
      source = new URL(state.coverUrl, document.baseURI);
      if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) return;
    } catch { return; }
    const image = element('img', 'now-playing-cover');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.draggable = false;
    imageRequest = image;
    image.onload = () => {
      if (!disposed && imageRequest === image) artwork.replaceChildren(image);
    };
    image.onerror = () => {
      if (!disposed && imageRequest === image) artwork.replaceChildren();
    };
    image.src = source.href;
  }

  function updateConfig(value = {}) {
    if (disposed) return;
    config = { ...NOW_PLAYING_DEFAULTS, ...value };
    surface.dataset.style = config.style;
    surface.dataset.layout = config.nowPlayingLayout;
    surface.style.setProperty('--now-playing-record-size', `${config.nowPlayingRecordSize}px`);
    surface.style.setProperty('--now-playing-gap', `${config.nowPlayingGap}px`);
    surface.style.setProperty('--now-playing-title-size', `${config.nowPlayingTitleFontSize}px`);
    surface.style.setProperty('--now-playing-artist-size', `${config.nowPlayingArtistFontSize}px`);
    surface.style.setProperty('--now-playing-title-color', config.nowPlayingTitleColor);
    surface.style.setProperty('--now-playing-artist-color', config.nowPlayingArtistColor);
    surface.style.setProperty('--now-playing-rotation-seconds', `${config.nowPlayingRotationSeconds}s`);
    surface.style.fontFamily = withMultilingualFallback(config.nowPlayingFontFamily);
    surface.style.opacity = String(config.nowPlayingOpacity);
    renderVisibility();
  }

  function updateState(value) {
    if (disposed) return;
    state = value || {};
    title.textContent = state.trackTitle || '等待播放';
    artist.textContent = Array.isArray(state.artists) ? state.artists.join(' / ') : '';
    updateArtwork();
    renderVisibility();
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateMotion();
  });
  observer.observe(root);
  document.addEventListener('visibilitychange', updateMotion);
  updateConfig();
  updateState();
  return {
    updateConfig,
    updateState,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateMotion);
      discardImage();
      surface.remove();
      root.classList.remove('now-playing-surface');
    },
  };
}
