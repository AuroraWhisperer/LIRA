// Queue overlay theme variables and panel styling.
'use strict';

import { applyOverlayTheme } from './overlay-theme.js';

import {
  hexToRgba,
  identityQueueFontSize,
  normalizeFontSize,
  queueScrollSeconds,
  queueSongFontSize,
  scaleToFontSize,
  withMultilingualFallback,
} from './queue-utils.js';

export function applyTheme(settings, style) {
  const panel = document.querySelector('.overlay-panel');
  panel.className = `overlay-panel queue-${style}`;
  const root = document.documentElement;
  applyOverlayTheme(root, panel, settings);
  root.style.setProperty('--overlay-index-color', settings.overlayIndexColor || '');
  setIdentityRuleThemeVars(root, settings);

  const titleEl = panel.querySelector('.overlay-title');
  if (titleEl) {
    const customTitle = String(settings.overlayTitle || '').trim();
    titleEl.textContent = customTitle || '点歌队列';
  }

  const songFontSize = queueSongFontSize(settings);
  root.style.setProperty('--overlay-song-font-size', `${songFontSize}px`);
  root.style.setProperty('--overlay-waiting-font-size', `${Math.max(10, Math.round(songFontSize * 0.65))}px`);
  root.style.setProperty('--identity-queue-font-size', `${identityQueueFontSize(settings)}px`);
  root.style.setProperty(
    '--illustrated-queue-font-family',
    withMultilingualFallback(settings.illustratedQueueFontFamily || 'default'),
  );
  root.style.setProperty('--illustrated-queue-font-weight', settings.illustratedQueueFontWeight || '800');
  root.style.setProperty('--illustrated-queue-text-color', settings.illustratedQueueTextColor || '#315d7d');
  panel.classList.toggle(
    'illustrated-custom-font',
    style !== 'identity' &&
      style !== 'classic' &&
      settings.illustratedQueueFontFamily &&
      settings.illustratedQueueFontFamily !== 'default',
  );
  panel.classList.toggle(
    'illustrated-custom-weight',
    style !== 'identity' &&
      style !== 'classic' &&
      settings.illustratedQueueFontWeight &&
      settings.illustratedQueueFontWeight !== 'default',
  );
  panel.classList.toggle(
    'illustrated-custom-text-color',
    style !== 'identity' && style !== 'classic' && settings.illustratedQueueUseCustomTextColor === 'true',
  );
  root.style.setProperty(
    '--overlay-title-font-size',
    `${normalizeFontSize(settings.queueTitleFontSize, scaleToFontSize(settings.themeFontScale, 30), 40, 10)}px`,
  );
  root.style.setProperty('--scroll-seconds', `${queueScrollSeconds(settings)}s`);

  panel.style.backgroundColor =
    style === 'classic' ? hexToRgba(settings.themeBackground || '#181823', settings.themeOpacity || 0.76) : '';
}

export function setIdentityRuleThemeVars(root, settings) {
  const defaultColors = ['#f5b72f', '#65aef7', '#8d67e8', '#f25f72', '#21b6a8', '#f97316'];
  for (let index = 0; index < defaultColors.length; index += 1) {
    const key = `overlayRuleColor${index + 1}`;
    root.style.setProperty(`--identity-rule-${index + 1}-bg`, settings[key] || defaultColors[index]);
  }
  const ruleFontSize = Math.max(8, normalizeFontSize(settings.overlayRuleFontSize, 10, 18)) * 2;
  root.style.setProperty('--identity-rule-font-size', `${ruleFontSize}px`);
}
