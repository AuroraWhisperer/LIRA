// Queue overlay theme variables and panel styling.
'use strict';

import {
  hexToRgb,
  hexToRgba,
  identityQueueFontSize,
  normalizeFontSize,
  overlayLowPowerEnabled,
  queueScrollSeconds,
  queueSongFontSize,
  scaleToFontSize,
  withMultilingualFallback,
} from './queue-utils.js';

export function applyTheme(settings, style) {
  const panel = document.querySelector('.overlay-panel');
  panel.className = `overlay-panel queue-${style}`;
  const root = document.documentElement;
  const lowPower = overlayLowPowerEnabled(settings);
  panel.classList.toggle('low-power', lowPower);

  root.style.setProperty(
    '--overlay-primary',
    settings.themePrimary || '#ff6f91',
  );
  root.style.setProperty('--overlay-accent', settings.themeAccent || '#21b6a8');
  root.style.setProperty('--overlay-text', settings.themeText || '#fff7fb');
  root.style.setProperty('--overlay-opacity', settings.themeOpacity || '0.76');
  root.style.setProperty('--overlay-radius', `${settings.themeRadius || 8}px`);
  root.style.setProperty(
    '--overlay-font-scale',
    settings.themeFontScale || '1',
  );

  const primaryRgb = hexToRgb(settings.themePrimary || '#ff6f91');
  root.style.setProperty('--overlay-primary-r', String(primaryRgb.r));
  root.style.setProperty('--overlay-primary-g', String(primaryRgb.g));
  root.style.setProperty('--overlay-primary-b', String(primaryRgb.b));

  const accentRgb = hexToRgb(settings.themeAccent || '#21b6a8');
  root.style.setProperty('--overlay-accent-r', String(accentRgb.r));
  root.style.setProperty('--overlay-accent-g', String(accentRgb.g));
  root.style.setProperty('--overlay-accent-b', String(accentRgb.b));

  const bgRgb = hexToRgb(settings.themeBackground || '#181823');
  root.style.setProperty('--overlay-bg-r', String(bgRgb.r));
  root.style.setProperty('--overlay-bg-g', String(bgRgb.g));
  root.style.setProperty('--overlay-bg-b', String(bgRgb.b));

  const blur = lowPower ? 0 : Number(settings.backdropBlur || 0);
  root.style.setProperty(
    '--overlay-blur',
    `${Number.isFinite(blur) ? Math.max(0, blur) : 0}px`,
  );
  panel.classList.toggle('has-backdrop-blur', blur > 0);

  const rawGlowIntensity = Number(settings.glowIntensity || 0);
  const glowIntensity =
    lowPower || !Number.isFinite(rawGlowIntensity)
      ? 0
      : Math.max(0, rawGlowIntensity);
  root.style.setProperty('--overlay-glow-size', `${glowIntensity}px`);
  root.style.setProperty(
    '--overlay-glow-color',
    glowIntensity > 0
      ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Math.min(0.25, glowIntensity / 80)})`
      : 'transparent',
  );

  const gradientEnabled = settings.enableGradient === 'true';
  panel.classList.toggle('gradient-bg', gradientEnabled);
  if (gradientEnabled) {
    const gradRgb = hexToRgb(
      settings.gradientEnd || settings.themeBackground || '#181823',
    );
    root.style.setProperty('--overlay-gradient-r', String(gradRgb.r));
    root.style.setProperty('--overlay-gradient-g', String(gradRgb.g));
    root.style.setProperty('--overlay-gradient-b', String(gradRgb.b));
  }

  const fontFamily = settings.overlayFontFamily || 'Microsoft YaHei';
  root.style.setProperty(
    '--overlay-font-family',
    withMultilingualFallback(fontFamily),
  );
  root.style.setProperty(
    '--overlay-font-weight',
    settings.overlayFontWeight || '800',
  );

  const songColor = settings.overlaySongColor || '';
  root.style.setProperty(
    '--overlay-song-color',
    songColor || settings.themeText || '#fff7fb',
  );
  root.style.setProperty(
    '--overlay-requester-color',
    settings.overlayRequesterColor || '',
  );
  root.style.setProperty(
    '--overlay-index-color',
    settings.overlayIndexColor || '',
  );
  setIdentityRuleThemeVars(root, settings);

  const titleEl = panel.querySelector('.overlay-title');
  if (titleEl) {
    const customTitle = String(settings.overlayTitle || '').trim();
    titleEl.textContent = customTitle || '点歌队列';
  }

  const songFontSize = queueSongFontSize(settings);
  root.style.setProperty('--overlay-song-font-size', `${songFontSize}px`);
  root.style.setProperty(
    '--overlay-waiting-font-size',
    `${Math.max(10, Math.round(songFontSize * 0.65))}px`,
  );
  root.style.setProperty(
    '--identity-queue-font-size',
    `${identityQueueFontSize(settings)}px`,
  );
  root.style.setProperty(
    '--illustrated-queue-font-family',
    withMultilingualFallback(settings.illustratedQueueFontFamily || 'default'),
  );
  root.style.setProperty(
    '--illustrated-queue-font-weight',
    settings.illustratedQueueFontWeight || '800',
  );
  root.style.setProperty(
    '--illustrated-queue-text-color',
    settings.illustratedQueueTextColor || '#315d7d',
  );
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
    style !== 'identity' &&
      style !== 'classic' &&
      settings.illustratedQueueUseCustomTextColor === 'true',
  );
  root.style.setProperty(
    '--overlay-title-font-size',
    `${normalizeFontSize(
      settings.queueTitleFontSize,
      scaleToFontSize(settings.themeFontScale, 30),
      40,
      10,
    )}px`,
  );
  root.style.setProperty(
    '--scroll-seconds',
    `${queueScrollSeconds(settings)}s`,
  );

  panel.style.backgroundColor =
    style === 'classic'
      ? hexToRgba(
          settings.themeBackground || '#181823',
          settings.themeOpacity || 0.76,
        )
      : '';
}

export function setIdentityRuleThemeVars(root, settings) {
  const defaultColors = [
    '#f5b72f',
    '#65aef7',
    '#8d67e8',
    '#f25f72',
    '#21b6a8',
    '#f97316',
  ];
  for (let index = 0; index < defaultColors.length; index += 1) {
    const key = `overlayRuleColor${index + 1}`;
    root.style.setProperty(
      `--identity-rule-${index + 1}-bg`,
      settings[key] || defaultColors[index],
    );
  }
  const ruleFontSize =
    Math.max(8, normalizeFontSize(settings.overlayRuleFontSize, 10, 18)) * 2;
  root.style.setProperty('--identity-rule-font-size', `${ruleFontSize}px`);
}
