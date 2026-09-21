import { hexToRgb, overlayLowPowerEnabled, withMultilingualFallback } from './overlay-utils-module.js';

export function applyOverlayTheme(root, panel, settings) {
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

  root.style.setProperty(
    '--overlay-font-family',
    withMultilingualFallback(settings.overlayFontFamily || 'Microsoft YaHei'),
  );
  root.style.setProperty(
    '--overlay-font-weight',
    settings.overlayFontWeight || '800',
  );
  root.style.setProperty(
    '--overlay-song-color',
    settings.overlaySongColor || settings.themeText || '#fff7fb',
  );
  root.style.setProperty(
    '--overlay-requester-color',
    settings.overlayRequesterColor || '',
  );
}
