import { parseHexColor } from '../shared/color-value.js';

const GENERIC_FONT_SUFFIX = /(?:^|,)\s*(sans-serif|serif|monospace)\s*$/i;

function textAlignToFlex(textAlign) {
  if (textAlign === 'center') return 'center';
  if (textAlign === 'right') return 'flex-end';
  if (textAlign === 'justify') return 'stretch';
  return 'flex-start';
}

function hexWithAlpha(color, alpha) {
  const match = parseHexColor(color);
  if (!match) return String(color || 'transparent');
  const clampedAlpha = Math.max(0, Math.min(1, alpha)) * match.alpha;
  return `rgba(${match.r}, ${match.g}, ${match.b}, ${clampedAlpha})`;
}

export function createLyricFontStack(fontFamily, fallbackFontFamily = '') {
  const genericFont = fontFamily.match(GENERIC_FONT_SUFFIX)?.[1] || 'sans-serif';
  // Route joining scripts as a whole, and fill gaps before generic families use OS fallback.
  return [
    '"Lira Lyric Scripts"',
    fontFamily.replace(GENERIC_FONT_SUFFIX, ''),
    '"Lira Lyric Korean"', '"Lira Xiaolai"', '"Lira Lyric Extended"',
    fallbackFontFamily.replace(GENERIC_FONT_SUFFIX, ''),
    '"Microsoft YaHei"', '"Nirmala UI"', '"Leelawadee UI"', '"Ebrima"',
    '"Segoe UI Symbol"', '"Segoe UI Emoji"', '"Apple Color Emoji"', 'system-ui', genericFont,
  ].filter(Boolean).join(', ');
}

export function applyLyricPreviewContrast(card, textColor) {
  const previewColor = parseHexColor(textColor);
  const channels = previewColor ? [previewColor.r, previewColor.g, previewColor.b].map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) : [0, 0, 0];
  card.classList.toggle('is-light-text', channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179);
}

export function applyDesktopLyricStyles(card, values) {
  applyLyricPreviewContrast(card, values.textColor);
  card.style.setProperty(
    '--preview-font',
    createLyricFontStack(values.fontFamily, values.fallbackFontFamily),
  );
  card.style.setProperty('--preview-weight', values.fontWeight);
  card.style.setProperty('--preview-color', values.textColor);
  card.style.setProperty('--preview-sung-color', values.sungColor);
  card.style.setProperty('--preview-text-align', values.textAlign);
  card.style.setProperty('--preview-row-align', textAlignToFlex(values.textAlign));
  card.style.setProperty('--preview-row-origin', values.textAlign === 'justify' ? 'center' : values.textAlign);
  card.style.setProperty('--preview-letter-spacing', `${values.letterSpacing}em`);
  card.style.setProperty('--preview-stroke', values.strokeColor);
  card.style.setProperty('--preview-size', `${values.fontSize}px`);
  card.style.setProperty('--preview-translation-size', `${values.fontSize * values.translationScale}px`);
  card.style.setProperty('--preview-stroke-width', `${values.strokeEnabled ? values.strokeWidth : 0}px`);
  card.style.setProperty('--preview-opacity', String(values.opacity));
  card.style.setProperty('--preview-base-opacity', String(values.baseOpacity));
  card.style.setProperty('--preview-translation-opacity', String(values.translationOpacity));
  card.style.setProperty('--preview-bg-opacity', String(values.backgroundOpacity));
  card.style.setProperty('--preview-scale', String(values.scale));
  card.style.setProperty('--preview-line-height', String(values.lineHeight));
  card.style.setProperty(
    '--preview-shadow-color',
    values.shadowEnabled ? hexWithAlpha(values.shadowColor, values.shadowIntensity) : 'transparent',
  );
  card.style.setProperty('--preview-shadow-blur', `${values.shadowBlur}px`);
  card.style.setProperty('--preview-shadow-x', `${values.shadowOffsetX}px`);
  card.style.setProperty('--preview-shadow-y', `${values.shadowOffsetY}px`);
  card.style.setProperty('--preview-interlude-offset', `${values.interludeOffsetEm}em`);
  card.style.setProperty('--preview-translate-x', `${values.translateX}px`);
  card.style.setProperty('--preview-translate-y', `${values.translateY}px`);
  card.style.setProperty('--preview-perspective', `${values.perspective}px`);
  card.style.setProperty('--preview-rotate-x', `${values.rotateX}deg`);
  card.style.setProperty('--preview-rotate-y', `${values.rotateY}deg`);
  card.style.setProperty('--preview-global-opacity', String(values.globalOpacity));
  card.style.setProperty('--preview-brightness', String(values.brightness));
  card.style.setProperty('--preview-contrast', String(values.contrast));
  card.style.setProperty('--preview-saturation', String(values.saturation));
  card.classList.toggle('is-translation-hidden', !values.showTranslation);
  card.classList.toggle('is-text-justify', values.textAlign === 'justify');
  card.classList.toggle('is-text-center', values.textAlign === 'center');
  card.classList.toggle('is-hide-passed', values.hidePassedLines);
  card.classList.toggle('is-traditional', values.traditionalMode);
  card.classList.toggle('is-current-enhanced', values.currentLineEnhanced);
  card.classList.toggle('is-karaoke-discrete', values.karaokeMode === 'discrete');
  card.classList.toggle('is-spring-enabled', values.springAnimation);
  card.classList.toggle('is-blur-enabled', values.blurEffect);
  card.classList.toggle('is-scale-enabled', values.scaleEffect);
  card.classList.toggle('is-background-enabled', values.backgroundEnabled);
  for (const rendererName of ['mesh', 'aurora', 'solid']) {
    card.classList.toggle(`is-background-${rendererName}`, values.backgroundRenderer === rendererName);
  }
}
