import { setValue } from '../shared/utils.js';
import { theme } from '../shared/theme.js';
import { normalizePersistedQueueStyle } from '../shared/queue-style-settings.js';
import { renderPresetCards } from './theme-preset-cards.js';

const ILLUSTRATED_QUEUE_STYLES = new Set([
  'storybook',
  'neon-vinyl',
  'cherry-ribbon',
  'golden-lily',
]);
const ILLUSTRATED_DEFAULT_LABELS = {
  storybook: { fontFamily: '幼圆', fontWeight: '粗体' },
  'neon-vinyl': { fontFamily: '微软雅黑', fontWeight: '较粗' },
  'cherry-ribbon': { fontFamily: '微软雅黑', fontWeight: '较粗' },
  'golden-lily': { fontFamily: '微软雅黑', fontWeight: '较粗' },
};

export function setOverlayStyle(style) {
  const { classicThemePresets, classicPresetLabels, classicPresetSwatches } = theme;
  const nextStyle = normalizePersistedQueueStyle(style);
  setValue('overlayQueueStyle', nextStyle);
  const illustratedDefaults =
    ILLUSTRATED_DEFAULT_LABELS[nextStyle] ||
    ILLUSTRATED_DEFAULT_LABELS.storybook;
  const fontFamilyDefault = document.querySelector(
    '#illustratedQueueFontFamily option[value="default"]',
  );
  const fontWeightDefault = document.querySelector(
    '#illustratedQueueFontWeight option[value="default"]',
  );
  if (fontFamilyDefault)
    fontFamilyDefault.textContent = illustratedDefaults.fontFamily;
  if (fontWeightDefault)
    fontWeightDefault.textContent = illustratedDefaults.fontWeight;
  document.querySelectorAll('[data-overlay-style]').forEach((button) => {
    button.classList.toggle(
      'active',
      button.dataset.overlayStyle === nextStyle,
    );
  });
  const classicArea = document.getElementById('classicThemeArea');
  const identityArea = document.getElementById('identityThemeArea');
  if (nextStyle !== 'classic') {
    if (classicArea) classicArea.hidden = true;
    if (identityArea) identityArea.hidden = false;
    identityArea
      ?.querySelectorAll('[data-identity-only]')
      .forEach((section) => {
        section.hidden = nextStyle !== 'identity';
      });
    identityArea
      ?.querySelectorAll('[data-illustrated-only]')
      .forEach((section) => {
        section.hidden = !ILLUSTRATED_QUEUE_STYLES.has(nextStyle);
      });
  } else {
    if (classicArea) classicArea.hidden = false;
    if (identityArea) identityArea.hidden = true;
    renderPresetCards(
      'classicPresets',
      classicThemePresets,
      classicPresetLabels,
      classicPresetSwatches,
    );
  }
}
