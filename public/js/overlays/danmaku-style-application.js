import {
  DANMAKU_STYLE_OPTIONS,
  DANMAKU_FONTS,
  RIPPLOID_COLOR_DEFAULTS,
  SPOOKY_COLOR_KEYS,
  SPOOKY_OPACITY_KEYS,
  TWITTER_LAYOUT_DEFAULTS,
  TWITTER_COLOR_DEFAULTS,
  styleOptionsFor,
} from '../shared/danmaku-style-options.js';

export function applyStyleOptions(document, style, allOptions, legacyDurationSeconds) {
  const options = styleOptionsFor(style, allOptions, legacyDurationSeconds);
  const composer = style === 'twitter' ? document.getElementById?.('twitterComposerText') : null;
  if (composer) composer.textContent = options.composerText;
  document.body.dataset.scrollDirection = options.scrollDirection;
  document.body.dataset.edgeFade = options.edgeFade || 'none';
  document.body.dataset.entranceAnimation = options.entranceAnimation || 'fade';
  document.body.dataset.entranceDurationMs = String(options.entranceDurationMs || 200);
  document.body.dataset.seaBreezeAlign = options.seaBreezeAlign || 'center';
  document.body.dataset.floatingEdgeFade = options.floatingEdgeFade || 'none';
  document.body.dataset.auroraEntrance = options.auroraEntrance || 'layered';
  document.body.dataset.startrailEntrance = options.startrailEntrance || 'spark';
  document.body.dataset.decorationShape = options.decorationShape || 'sparkle';
  document.body.dataset.ambientMotion = options.ambientMotion || 'on';
  document.body.dataset.startrailDust = options.startrailDust || 'on';
  document.body.dataset.auroraPalette = options.auroraPalette || 'lilac';
  document.body.dataset.sinkingPalette = options.sinkingPalette || 'ivory';
  document.body.dataset.auroraCharm = options.auroraCharm || 'star';
  document.body.dataset.spookyTheme = options.spookyTheme || 'default';
  document.body.dataset.spookyFrame = options.spookyFrame || 'show';
  document.body.dataset.comicWritingMode = options.comicWritingMode || 'horizontal';
  document.body.dataset.comicShape = options.comicShape || 'mixed';
  document.body.dataset.comicEntrance = options.comicEntrance || 'pop';
  document.body.dataset.comicEntranceMs = String(options.comicEntranceMs || 420);
  document.body.dataset.windowPalette = options.windowPalette || 'porcelain';
  document.body.dataset.windowControls = options.windowControls || 'show';
  document.body.dataset.windowEntrance = options.windowEntrance || 'mixed';
  document.body.dataset.windowEntranceMs = String(options.windowEntranceMs || 460);
  document.body.dataset.stardustEntrance = options.stardustEntrance || 'on';
  document.body.dataset.stardustNicknames = options.stardustNicknames || 'show';
  document.body.dataset.stardustGiftThreshold = String(options.stardustGiftThreshold ?? .01);
  document.body.dataset.stardustSwapAnchors = options.stardustSwapAnchors || 'off';
  for (const key of ['stargazerPalette', 'stargazerLayout', 'stargazerAlign', 'stargazerFrame', 'stargazerPerspective', 'stargazerGradient']) {
    document.body.dataset[key] = options[key] || '';
  }
  for (const key of ['gradientPalette', 'gradientUnderline', 'glassBubbleReveal', 'glassBubbleSweep',
    'celestialStarDensity', 'celestialStarShape', 'celestialSeparator', 'glassTime', 'glassDensity',
    'darkMoonPalette', 'darkMoonSparks', 'wireframeOrbit', 'wireframeEntrance']) {
    document.body.dataset[key] = options[key] || '';
  }
  const root = document.documentElement.style;
  root.setProperty('--gradient-cycle', `${options.gradientCycleSeconds ?? 10}s`);
  root.setProperty('--glass-bubble-highlight', String((options.glassBubbleHighlight ?? 100) / 100));
  root.setProperty('--celestial-nebula-opacity', String((options.celestialNebulaOpacity ?? 30) / 100));
  root.setProperty('--glass-glint-intensity', String((options.glassGlintIntensity ?? 100) / 100));
  root.setProperty('--moon-ring-size', String((options.darkMoonRingSize ?? 100) / 100));
  root.setProperty('--wireframe-fade-length', `${options.wireframeFadeLength ?? 100}%`);
  root.setProperty('--sea-breeze-reflection-opacity', String((options.seaBreezeReflectionOpacity ?? 28) / 100));
  root.setProperty('--sea-breeze-reflection-length', String((options.seaBreezeReflectionLength ?? 130) / 100));
  root.setProperty('--sea-breeze-reflection-gap', `${options.seaBreezeReflectionGap ?? -9}px`);
  document.body.dataset.seaBreezeReflection = options.seaBreezeReflectionOpacity === 0 || options.seaBreezeReflectionLength === 0 ? 'off' : 'on';
  document.body.dataset.glassBubbleTypingSpeed = String(options.glassBubbleTypingSpeed ?? 26);
  document.body.dataset.wireframeEntranceMs = String(options.wireframeEntranceMs ?? 700);
  root.setProperty('--stargazer-color', options.stargazerColor || '#c04efe');
  root.setProperty('--stargazer-width', `${options.stargazerWidth ?? 320}px`);
  root.setProperty('--stargazer-gap', `${options.stargazerGap ?? 24}px`);
  root.setProperty('--stargazer-angle', `${(options.stargazerPerspective === 'left' ? -1 : 1) * (options.stargazerAngle ?? 6)}deg`);
  root.setProperty('--stargazer-glow', `${options.stargazerGlow ?? 8}px`);
  root.setProperty('--stargazer-gradient', `${options.stargazerGradientOpacity ?? 40}%`);
  root.setProperty('--window-width', `${options.windowWidth ?? 340}px`);
  root.setProperty('--window-radius', `${options.windowRadius ?? 22}px`);
  root.setProperty('--danmaku-floating-edge-size', `${options.floatingEdgeFadeSize ?? 28}px`);
  root.setProperty('--aurora-entry-duration', `${options.auroraEntranceMs ?? 520}ms`);
  root.setProperty('--comic-stroke-width', `${options.comicStrokeWidth ?? 2}px`);
  root.setProperty('--comic-texture', String((options.comicTexture ?? 8) / 100));
  root.setProperty('--startrail-color', options.startrailColor || '#b9dfff');
  root.setProperty('--startrail-star-size', `${options.startrailStarSize ?? 24}px`);
  root.setProperty('--startrail-tail-length', `${options.startrailTailLength ?? 180}px`);
  root.setProperty('--startrail-glow', String((options.startrailGlow ?? 45) / 100));
  root.setProperty('--startrail-entry-duration', `${options.startrailEntranceMs ?? 680}ms`);
  root.setProperty('--aurora-sheen', String((options.auroraSheen ?? 55) / 100));
  root.setProperty('--aurora-sway', `${options.auroraSway ?? 5}deg`);
  for (const key of Object.keys(TWITTER_LAYOUT_DEFAULTS)) document.body.dataset[key] = options[key] || 'show';
  for (const key of Object.keys(TWITTER_COLOR_DEFAULTS)) {
    root.setProperty(`--twitter-event-color-${key.replace('twitterColor', '')}`, options[key] || '');
  }
  root.setProperty('--danmaku-bubble-color', options.bubbleColor && options.bubbleColor !== 'default' ? options.bubbleColor : '');
  root.setProperty('--danmaku-text-color', options.textColor);
  for (const key of Object.keys(RIPPLOID_COLOR_DEFAULTS)) {
    const suffix = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    root.setProperty(`--ripploid-${suffix}`, options[key] || '');
  }
  for (const key of SPOOKY_COLOR_KEYS.filter(key => key !== 'textColor')) {
    const suffix = key.slice(6).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    root.setProperty(`--spooky-custom${suffix}`, options[key] && options[key] !== 'default' ? options[key] : '');
  }
  root.setProperty('--spooky-custom-message-right', options.spookyMessageColor && options.spookyMessageColor !== 'default'
    ? `color-mix(in srgb, ${options.spookyMessageColor} 65%, black)` : '');
  for (const key of SPOOKY_OPACITY_KEYS) {
    const suffix = key.slice(6, -7).toLowerCase();
    root.setProperty(`--spooky-${suffix}-weight`, `${options[key] ?? 100}%`);
  }
  document.body.dataset.spookyCustomAccent = String(Boolean(options.spookyAccentColor && options.spookyAccentColor !== 'default'));
  document.body.dataset.customTextColor = String(style === 'spooky'
    ? Object.hasOwn(allOptions?.spooky || {}, 'textColor') && options.textColor !== 'default'
    : options.textColor !== DANMAKU_STYLE_OPTIONS[style]?.defaultTextColor);
  root.setProperty('--danmaku-font-size', `${options.fontSize}px`);
  root.setProperty(
    '--danmaku-custom-font',
    Object.hasOwn(DANMAKU_FONTS, options.fontFamily)
      ? DANMAKU_FONTS[options.fontFamily] || 'inherit'
      : `${options.fontFamily}, ${DANMAKU_FONTS.sans}`,
  );
  root.setProperty('--danmaku-background-opacity', String(options.backgroundOpacity / 100));
  root.setProperty('--danmaku-background-weight', `${options.backgroundOpacity}%`);
  document.body.dataset.customSize = String(options.fontSize !== (DANMAKU_STYLE_OPTIONS[style]?.defaultFontSize || 30));
  document.body.dataset.customFont = String(options.fontFamily !== 'default');
  document.body.dataset.customBackground = String(options.backgroundOpacity !== 100);
  return options;
}
