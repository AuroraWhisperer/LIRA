import { hexToRgb, overlayLowPowerEnabled, withMultilingualFallback } from './overlay-utils-module.js';

// 各页面自己的默认值：调用方只覆盖需要不同的键。
const THEME_DEFAULTS = Object.freeze({
  themeOpacity: '0.76',
  themeRadius: 8,
  backdropBlur: 0,
  glowIntensity: 0,
  // 缺省渐变终点沿用背景色；点歌板保留自己的固定回退。
  gradientEnd: null,
  // 缺省歌名颜色沿用正文色；点歌板显式留空后再回退。
  overlaySongColor: null,
});

/**
 * Apply the shared overlay theme contract (CSS variables plus panel classes).
 * @param {HTMLElement} root - Document element receiving the variables.
 * @param {HTMLElement} panel - Overlay panel receiving the state classes.
 * @param {Object} settings - Settings snapshot.
 * @param {Object} [options]
 * @param {Function} [options.resolve] - `(key, fallback) => value`;页面用它可以保留自己的覆盖规则。
 * @param {Object} [options.defaults] - 覆盖本页与共享默认值不同的键。
 * @param {Function} [options.fontScale] - 返回 `--overlay-font-scale` 的值。
 */
export function applyOverlayTheme(root, panel, settings, options = {}) {
  const resolve = options.resolve ?? ((key, fallback) => settings[key] || fallback);
  const defaults = { ...THEME_DEFAULTS, ...options.defaults };
  const fontScale = options.fontScale ?? (() => settings.themeFontScale || '1');
  const lowPower = overlayLowPowerEnabled(settings);
  panel.classList.toggle('low-power', lowPower);

  root.style.setProperty('--overlay-primary', resolve('themePrimary', '#ff6f91'));
  root.style.setProperty('--overlay-accent', resolve('themeAccent', '#21b6a8'));
  root.style.setProperty('--overlay-text', resolve('themeText', '#fff7fb'));
  root.style.setProperty('--overlay-opacity', resolve('themeOpacity', defaults.themeOpacity));
  root.style.setProperty('--overlay-radius', `${resolve('themeRadius', defaults.themeRadius)}px`);
  root.style.setProperty('--overlay-font-scale', fontScale());

  const primaryRgb = hexToRgb(resolve('themePrimary', '#ff6f91'));
  root.style.setProperty('--overlay-primary-r', String(primaryRgb.r));
  root.style.setProperty('--overlay-primary-g', String(primaryRgb.g));
  root.style.setProperty('--overlay-primary-b', String(primaryRgb.b));

  const accentRgb = hexToRgb(resolve('themeAccent', '#21b6a8'));
  root.style.setProperty('--overlay-accent-r', String(accentRgb.r));
  root.style.setProperty('--overlay-accent-g', String(accentRgb.g));
  root.style.setProperty('--overlay-accent-b', String(accentRgb.b));

  const bgHex = resolve('themeBackground', '#181823');
  const bgRgb = hexToRgb(bgHex);
  root.style.setProperty('--overlay-bg-r', String(bgRgb.r));
  root.style.setProperty('--overlay-bg-g', String(bgRgb.g));
  root.style.setProperty('--overlay-bg-b', String(bgRgb.b));

  const blur = lowPower ? 0 : Number(resolve('backdropBlur', defaults.backdropBlur));
  root.style.setProperty('--overlay-blur', `${Number.isFinite(blur) ? Math.max(0, blur) : 0}px`);
  panel.classList.toggle('has-backdrop-blur', blur > 0);

  const rawGlowIntensity = Number(resolve('glowIntensity', defaults.glowIntensity));
  const glowIntensity = lowPower || !Number.isFinite(rawGlowIntensity) ? 0 : Math.max(0, rawGlowIntensity);
  root.style.setProperty('--overlay-glow-size', `${glowIntensity}px`);
  root.style.setProperty(
    '--overlay-glow-color',
    glowIntensity > 0
      ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Math.min(0.25, glowIntensity / 80)})`
      : 'transparent',
  );

  const gradientEnabled = String(resolve('enableGradient', 'false')) === 'true';
  panel.classList.toggle('gradient-bg', gradientEnabled);
  if (gradientEnabled) {
    const gradRgb = hexToRgb(resolve('gradientEnd', defaults.gradientEnd) || bgHex);
    root.style.setProperty('--overlay-gradient-r', String(gradRgb.r));
    root.style.setProperty('--overlay-gradient-g', String(gradRgb.g));
    root.style.setProperty('--overlay-gradient-b', String(gradRgb.b));
  }

  root.style.setProperty(
    '--overlay-font-family',
    withMultilingualFallback(resolve('overlayFontFamily', 'Microsoft YaHei')),
  );
  root.style.setProperty('--overlay-font-weight', resolve('overlayFontWeight', '800'));
  root.style.setProperty(
    '--overlay-song-color',
    resolve('overlaySongColor', defaults.overlaySongColor) || resolve('themeText', '#fff7fb'),
  );
  root.style.setProperty('--overlay-requester-color', settings.overlayRequesterColor || '');
}
