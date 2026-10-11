'use strict';

import { initParameterRanges } from '../../shared/parameter-range.js';
import { ensureSavedFontOption, registerLocalFontSelect } from '../../shared/local-font-library.js';
import { scrollActiveLyricIntoView } from './lyric-layout.js';

export const PLAYER_APPEARANCE_KEY = 'playbackAppearance:v1';
export const DEFAULT_PLAYER_APPEARANCE = Object.freeze({
  style: 'turntable',
  artworkSize: 100,
  rotation: true,
  backgroundMode: 'auto',
  backgroundColor: '#fff1f4',
  gradientColor: '#c9dced',
  backgroundOpacity: 100,
  fontFamily: 'system',
  lyricFontFamily: 'inherit',
  textAlign: 'left',
  titleSize: 42,
  artistSize: 20,
  lyricSize: 32,
  lyricLineHeight: 1.4,
  lyricLineGap: 28,
  lyricLetterSpacing: 0,
  lyricFontWeight: '700',
  activeLyricScale: 112.5,
  textColors: 'theme',
  titleColor: '#302a27',
  artistColor: '#665b53',
  lyricColor: '#796d63',
  activeLyricColor: '#302a27',
});

const CHOICES = {
  style: ['turntable', 'vinyl', 'cover'],
  backgroundMode: ['auto', 'solid', 'gradient'],
  textAlign: ['left', 'center'],
  textColors: ['theme', 'custom'],
  lyricFontWeight: ['400', '500', '600', '700'],
};
const RANGES = {
  artworkSize: [60, 110], backgroundOpacity: [0, 100],
  titleSize: [8, 200], artistSize: [8, 120], lyricSize: [8, 160],
  lyricLineHeight: [0.8, 4, 0.1], lyricLineGap: [0, 200],
  lyricLetterSpacing: [-2, 24, 0.5], activeLyricScale: [100, 300, 0.5],
};
const FONTS = {
  sans: '"Microsoft YaHei", "PingFang SC", sans-serif',
  serif: '"SimSun", "Songti SC", serif',
  kai: '"KaiTi", "STKaiti", serif',
  maiyuan: '"Lira Maiyuan", "Microsoft YaHei", sans-serif',
  kuaile: '"Lira Kuaile", "Microsoft YaHei", sans-serif',
  smiley: '"Lira Smiley", "Microsoft YaHei", sans-serif',
};
const initializedPanels = new WeakSet();

function normalizeFont(value, fallback) {
  if (typeof value !== 'string') return fallback;
  if (value === 'system' || value === 'inherit' || Object.hasOwn(FONTS, value)) return value;
  // Local-font-library emits one escaped, quoted family, never a CSS declaration or font stack.
  if (value.length <= 404 && /^"(?:[^"\\\u0000-\u001f\u007f]|\\["\\])+"$/.test(value)) return value;
  return fallback;
}

function fontStack(value) {
  return FONTS[value] || (value.startsWith('"') ? `${value}, "Microsoft YaHei", sans-serif` : null);
}

export function normalizePlayerAppearance(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { ...DEFAULT_PLAYER_APPEARANCE };
  for (const [key, options] of Object.entries(CHOICES)) {
    if (options.includes(source[key])) result[key] = source[key];
  }
  for (const key of ['fontFamily', 'lyricFontFamily']) {
    result[key] = normalizeFont(source[key], result[key]);
  }
  for (const [key, [min, max, step = 1]] of Object.entries(RANGES)) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key])) {
      result[key] = Number(Math.min(max, Math.max(min, Math.round(source[key] / step) * step)).toFixed(2));
    }
  }
  for (const key of Object.keys(result).filter((key) => key.endsWith('Color'))) {
    if (typeof source[key] === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(source[key])) {
      result[key] = source[key].toLowerCase();
    }
  }
  if (typeof source.rotation === 'boolean') result.rotation = source.rotation;
  return result;
}

export function readPlayerAppearance(storage) {
  try {
    return normalizePlayerAppearance(JSON.parse(storage.getItem(PLAYER_APPEARANCE_KEY)));
  } catch {
    return { ...DEFAULT_PLAYER_APPEARANCE };
  }
}

export function savePlayerAppearance(storage, settings) {
  try {
    storage.setItem(PLAYER_APPEARANCE_KEY, JSON.stringify(normalizePlayerAppearance(settings)));
    return true;
  } catch {
    return false;
  }
}

export function applyPlayerAppearance(root, settings) {
  root.dataset.playerStyle = settings.style;
  root.dataset.playerBackground = settings.backgroundMode;
  root.dataset.playerRotation = String(settings.rotation);
  root.dataset.playerAlign = settings.textAlign;
  root.dataset.playerEmphasis = settings.activeLyricScale === 112.5 ? 'default' : 'custom';
  const customColors = settings.textColors === 'custom';
  const variables = {
    '--player-art-scale': settings.artworkSize / 100,
    '--player-background-color': settings.backgroundColor,
    '--player-gradient-color': settings.gradientColor,
    '--player-background-opacity': settings.backgroundOpacity / 100,
    '--player-font': fontStack(settings.fontFamily),
    '--player-lyric-font': settings.lyricFontFamily === 'inherit' ? null : fontStack(settings.lyricFontFamily) || 'var(--font)',
    '--player-text-align': settings.textAlign,
    '--player-title-size': settings.titleSize === 42 ? null : `${settings.titleSize}px`,
    '--player-artist-size': settings.artistSize === 20 ? null : `${settings.artistSize}px`,
    '--player-lyric-size': settings.lyricSize === 32 ? null : `${settings.lyricSize}px`,
    '--player-active-lyric-size': settings.lyricSize === 32 && settings.activeLyricScale === 112.5
      ? null : `${settings.lyricSize * settings.activeLyricScale / 100}px`,
    '--player-active-lyric-scale': settings.activeLyricScale / 100,
    '--player-translation-size': settings.lyricSize === 32 ? null : `${settings.lyricSize * 0.5625}px`,
    '--player-lyric-line-height': settings.lyricLineHeight === 1.4 ? null : settings.lyricLineHeight,
    '--player-lyric-line-padding': settings.lyricLineGap === 28 ? null : `${settings.lyricLineGap / 2}px`,
    '--player-lyric-letter-spacing': settings.lyricLetterSpacing === 0 ? null : `${settings.lyricLetterSpacing}px`,
    '--player-lyric-weight': settings.lyricFontWeight === '700' ? null : settings.lyricFontWeight,
    '--player-title-color': customColors ? settings.titleColor : null,
    '--player-artist-color': customColors ? settings.artistColor : null,
    '--player-lyric-color': customColors ? settings.lyricColor : null,
    '--player-active-lyric-color': customColors ? settings.activeLyricColor : null,
  };
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) root.style.removeProperty(key);
    else root.style.setProperty(key, String(value));
  }
}

function clonePlayerVisual(source, suffix) {
  const content = source.cloneNode(true);
  content.removeAttribute('id');
  // SVG paint servers need their own IDs; ordinary player IDs must remain unique.
  for (const node of content.querySelectorAll('[id]')) {
    const id = node.id;
    if (node.closest('defs')) {
      node.id = `${id}${suffix}`;
      for (const consumer of content.querySelectorAll('[fill], [stroke], [filter]')) {
        for (const attribute of ['fill', 'stroke', 'filter']) {
          if (consumer.getAttribute(attribute) === `url(#${id})`) {
            consumer.setAttribute(attribute, `url(#${id}${suffix})`);
          }
        }
      }
    } else node.removeAttribute('id');
  }
  return content;
}

function renderPreviewLyrics(canvas, longSample) {
  const lyrics = canvas.querySelector('.player-fs-lyrics');
  const samples = longSample ? [
    ['把今天唱成一首歌，让每一个平凡的瞬间都值得被记得', 'Turn the day into a song, and keep every little moment.'],
    ['让喜欢的旋律慢慢响起，陪你走过热闹街角和安静的漫长夜晚', 'Let the melody stay with you, through busy streets and quiet nights.'],
    ['下一句，留给此刻的你', 'The next line is yours.'],
  ] : [
    ['把今天唱成一首歌'], ['让喜欢的旋律慢慢响起'], ['下一句，留给此刻的你'],
  ];
  lyrics.replaceChildren(...samples.map(([text, translation], index) => {
    const line = document.createElement('div');
    line.className = `player-fs-lyric-line${index === 1 ? ' active' : ''}`;
    const body = document.createElement('div');
    body.className = 'lyric-content';
    const primary = document.createElement('span');
    primary.className = 'lyric-text';
    primary.textContent = text;
    body.append(primary);
    if (translation) {
      const secondary = document.createElement('span');
      secondary.className = 'lyric-trans';
      secondary.textContent = translation;
      body.append(secondary);
    }
    line.append(body);
    return line;
  }));
}

function createAppearancePreview(playerRoot, canvas) {
  const content = clonePlayerVisual(playerRoot.querySelector('.player-fs-content'), 'Preview');
  content.querySelectorAll('button, .player-fs-lyric-toggles').forEach((node) => node.remove());
  content.querySelector('.player-fs-title').textContent = '此刻，听见喜欢';
  content.querySelector('.player-fs-artist').textContent = '歌手名字';
  const background = playerRoot.querySelector('.player-fs-bg').cloneNode(false);
  background.removeAttribute('id');
  canvas.append(background, content);
  renderPreviewLyrics(canvas, false);
}

export function initPlayerAppearance(playerRoot, { documentRef = document, storage, onTypographyChange = () => {} } = {}) {
  const panel = documentRef.getElementById('playerAppearance');
  if (!playerRoot || !panel || initializedPanels.has(panel)) return;
  initializedPanels.add(panel);
  if (!storage) {
    try { storage = window.localStorage; } catch { storage = null; }
  }
  let settings = readPlayerAppearance(storage);
  const fields = [...panel.querySelectorAll('[data-appearance-key]')];
  const feedback = panel.querySelector('[data-appearance-feedback]');
  const preview = panel.querySelector('.player-appearance-preview');
  const canvas = panel.querySelector('.player-appearance-canvas');
  const fontSelects = fields.filter((field) => ['fontFamily', 'lyricFontFamily'].includes(field.dataset.appearanceKey));
  let layoutTimer;
  function positionPreviewLyric() {
    scrollActiveLyricIntoView(canvas.querySelector('.player-fs-lyrics'));
  }
  function refreshTypography() {
    clearTimeout(layoutTimer);
    // Existing lyric size transitions settle before the player measures the active line.
    layoutTimer = setTimeout(() => {
      onTypographyChange();
      positionPreviewLyric();
    }, 320);
  }
  createAppearancePreview(playerRoot, canvas);
  for (const thumbnail of panel.querySelectorAll('[data-appearance-thumbnail]')) {
    thumbnail.dataset.playerStyle = thumbnail.dataset.appearanceThumbnail;
    thumbnail.dataset.playerRotation = 'false';
    thumbnail.append(clonePlayerVisual(playerRoot.querySelector('.player-fs-vinyl'), thumbnail.dataset.playerStyle));
  }

  function render() {
    applyPlayerAppearance(playerRoot, settings);
    applyPlayerAppearance(canvas, settings);
    for (const field of fields) {
      const key = field.dataset.appearanceKey;
      if (fontSelects.includes(field)) ensureSavedFontOption(field, settings[key]);
      if (field.type === 'checkbox') field.checked = settings[key];
      else if (field.type === 'radio') field.checked = field.value === settings[key];
      else field.value = String(settings[key]);
    }
    for (const sample of panel.querySelectorAll('[data-appearance-font-sample]')) {
      const choice = settings[sample.dataset.appearanceFontSample];
      sample.style.fontFamily = fontStack(choice === 'inherit' ? settings.fontFamily : choice) || 'var(--font)';
    }
    panel.querySelector('[data-appearance-background-colors]').hidden = settings.backgroundMode === 'auto';
    panel.querySelector('[data-appearance-gradient]').hidden = settings.backgroundMode !== 'gradient';
    panel.dataset.appearanceBackground = settings.backgroundMode;
    panel.querySelector('[data-appearance-text-colors]').hidden = settings.textColors !== 'custom';
    panel.querySelector('[data-appearance-key="rotation"]').disabled = settings.style === 'cover';
    initParameterRanges(panel);
    refreshTypography();
  }

  function update(event) {
    const field = event.target.closest('[data-appearance-key]');
    if (!field || field.disabled || (field.type === 'radio' && !field.checked)) return;
    const key = field.dataset.appearanceKey;
    if (!field.checkValidity()) {
      if (event.type === 'change') field.value = String(settings[key]);
      return;
    }
    const value = field.type === 'checkbox' ? field.checked : RANGES[key] ? Number(field.value) : field.value;
    if (value === settings[key]) return;
    settings = normalizePlayerAppearance({ ...settings, [key]: value });
    render();
    feedback.textContent = savePlayerAppearance(storage, settings)
      ? '已自动保存'
      : '外观已生效，但未能保存；请重试，重启后可能恢复原设置。';
  }

  panel.addEventListener('input', update);
  panel.addEventListener('change', update);
  panel.querySelector('[data-appearance-reset]').addEventListener('click', () => {
    settings = { ...DEFAULT_PLAYER_APPEARANCE };
    render();
    feedback.textContent = savePlayerAppearance(storage, settings)
      ? '已恢复默认外观'
      : '已恢复默认外观，但未能保存；请重试。';
  });
  panel.querySelector('[data-appearance-group-reset]').addEventListener('click', () => {
    const group = panel.querySelector('[data-appearance-group]:not([hidden])');
    for (const field of group.querySelectorAll('[data-appearance-key]')) {
      const key = field.dataset.appearanceKey;
      settings[key] = DEFAULT_PLAYER_APPEARANCE[key];
    }
    render();
    feedback.textContent = savePlayerAppearance(storage, settings)
      ? '已恢复本组默认，其他设置已保留'
      : '已恢复本组默认，但未能保存；请重试。';
  });
  panel.querySelector('[data-appearance-long-sample]').addEventListener('change', (event) => {
    renderPreviewLyrics(canvas, event.target.checked);
    refreshTypography();
  });
  render();
  const unregisterFonts = fontSelects.map((select) => registerLocalFontSelect(select));
  documentRef.fonts?.addEventListener('loadingdone', refreshTypography);

  const observer = new ResizeObserver(() => {
    const width = playerRoot.clientWidth;
    const height = playerRoot.clientHeight;
    if (!width || !height || !preview.clientWidth) return;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    preview.style.aspectRatio = `${width} / ${height}`;
    preview.style.setProperty('--player-preview-ratio', String(width / height));
    canvas.style.zoom = String(preview.clientWidth / width);
    positionPreviewLyric();
  });
  observer.observe(preview);
  observer.observe(playerRoot);
  const background = playerRoot.querySelector('.player-fs-bg');
  const previewBackground = canvas.querySelector('.player-fs-bg');
  const backgroundObserver = new MutationObserver(() => {
    previewBackground.className = background.className;
    previewBackground.style.cssText = background.style.cssText;
  });
  backgroundObserver.observe(background, { attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    backgroundObserver.disconnect();
    clearTimeout(layoutTimer);
    unregisterFonts.forEach((unregister) => unregister?.());
    documentRef.fonts?.removeEventListener('loadingdone', refreshTypography);
  }, { once: true });
}
