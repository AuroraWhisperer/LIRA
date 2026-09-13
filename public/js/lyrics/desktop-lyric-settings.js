const KARAOKE_MODES = ['off', 'continuous', 'discrete'];

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function numberSetting(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolSetting(value, fallback) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function enumSetting(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function normalizeDesktopLyricSettings(settings = {}, defaults = {}) {
  const values = { ...defaults, ...settings };
  const explicitKaraokeMode = KARAOKE_MODES.includes(
    settings.desktopLyricKaraokeMode,
  )
    ? settings.desktopLyricKaraokeMode
    : null;
  const karaokeMode =
    explicitKaraokeMode ||
    (boolSetting(settings.desktopLyricKaraokeEnabled, true)
      ? 'continuous'
      : 'off');
  return {
    fontFamily: String(
      values.desktopLyricFontFamily || defaults.desktopLyricFontFamily,
    ),
    fallbackFontFamily: String(
      values.desktopLyricFallbackFontFamily ||
        defaults.desktopLyricFallbackFontFamily,
    ),
    fontWeight: String(
      values.desktopLyricFontWeight || defaults.desktopLyricFontWeight,
    ),
    textColor: String(
      values.desktopLyricTextColor || defaults.desktopLyricTextColor,
    ),
    textAlign: enumSetting(
      values.desktopLyricTextAlign,
      ['left', 'center', 'right', 'justify'],
      'left',
    ),
    letterSpacing: clamp(
      numberSetting(values.desktopLyricLetterSpacing, 0),
      -0.1,
      0.3,
    ),
    fontSize: clamp(numberSetting(values.desktopLyricFontSize, 56), 24, 72),
    lineHeight: clamp(numberSetting(values.desktopLyricLineHeight, 1.4), 1, 2),
    strokeEnabled: boolSetting(values.desktopLyricStrokeEnabled, true),
    strokeColor: String(
      values.desktopLyricStrokeColor || defaults.desktopLyricStrokeColor,
    ),
    strokeWidth: clamp(numberSetting(values.desktopLyricStrokeWidth, 3), 0, 6),
    shadowEnabled: boolSetting(values.desktopLyricShadowEnabled, true),
    shadowColor: String(
      values.desktopLyricShadowColor || defaults.desktopLyricShadowColor,
    ),
    shadowIntensity: clamp(
      numberSetting(values.desktopLyricShadowIntensity, 0.35),
      0,
      1,
    ),
    shadowBlur: clamp(numberSetting(values.desktopLyricShadowBlur, 8), 0, 30),
    shadowOffsetX: clamp(
      numberSetting(values.desktopLyricShadowOffsetX, 0),
      -20,
      20,
    ),
    shadowOffsetY: clamp(
      numberSetting(values.desktopLyricShadowOffsetY, 3),
      -20,
      20,
    ),
    showTranslation: boolSetting(values.desktopLyricShowTranslation, true),
    translationScale: clamp(
      numberSetting(values.desktopLyricTranslationScale, 0.65),
      0.4,
      1,
    ),
    karaokeEnabled: karaokeMode !== 'off',
    karaokeMode,
    hidePassedLines: boolSetting(values.desktopLyricHidePassedLines, false),
    traditionalMode: boolSetting(values.desktopLyricTraditionalMode, false),
    interludeOffsetEm: clamp(
      numberSetting(values.desktopLyricInterludeOffsetEm, 0),
      -10,
      10,
    ),
    hideOnPause: boolSetting(values.desktopLyricHideOnPause, false),
    currentLineEnhanced: boolSetting(
      values.desktopLyricCurrentLineEnhanced,
      true,
    ),
    opacity: clamp(numberSetting(values.desktopLyricOpacity, 0.95), 0, 1),
    baseOpacity: clamp(
      numberSetting(values.desktopLyricBaseOpacity, 0.38),
      0,
      1,
    ),
    translationOpacity: clamp(
      numberSetting(values.desktopLyricTranslationOpacity, 0.72),
      0,
      1,
    ),
    timeOffsetMs: clamp(
      numberSetting(values.desktopLyricTimeOffsetMs, 0),
      -5000,
      5000,
    ),
    showTitleWhenNoLyric: boolSetting(
      values.desktopLyricShowTitleWhenNoLyric,
      false,
    ),
    noLyricText: String(
      values.desktopLyricNoLyricText || defaults.desktopLyricNoLyricText,
    ).slice(0, 80),
    springAnimation: boolSetting(values.desktopLyricSpringAnimation, false),
    blurEffect: boolSetting(values.desktopLyricBlurEffect, false),
    scaleEffect: boolSetting(values.desktopLyricScaleEffect, false),
    scale: clamp(numberSetting(values.desktopLyricScale, 1), 0.5, 2),
    alignPosition: clamp(
      numberSetting(values.desktopLyricAlignPosition, 0.5),
      0,
      1,
    ),
    alignAnchor: enumSetting(
      values.desktopLyricAlignAnchor,
      ['start', 'center', 'end'],
      'center',
    ),
    translateX: clamp(
      numberSetting(values.desktopLyricTranslateX, 0),
      -500,
      500,
    ),
    translateY: clamp(
      numberSetting(values.desktopLyricTranslateY, 0),
      -500,
      500,
    ),
    perspective: clamp(
      numberSetting(values.desktopLyricPerspective, 800),
      200,
      2000,
    ),
    rotateX: clamp(numberSetting(values.desktopLyricRotateX, 0), -45, 45),
    rotateY: clamp(numberSetting(values.desktopLyricRotateY, 0), -45, 45),
    backgroundEnabled: boolSetting(values.desktopLyricBackgroundEnabled, false),
    backgroundRenderer: enumSetting(
      values.desktopLyricBackgroundRenderer,
      ['mesh', 'aurora', 'solid'],
      'mesh',
    ),
    backgroundOpacity: clamp(
      numberSetting(values.desktopLyricBgOpacity, 0.15),
      0,
      1,
    ),
    globalOpacity: clamp(
      numberSetting(values.desktopLyricGlobalOpacity, 1),
      0,
      1,
    ),
    brightness: clamp(numberSetting(values.desktopLyricBrightness, 1), 0.2, 2),
    contrast: clamp(numberSetting(values.desktopLyricContrast, 1), 0.2, 2),
    saturation: clamp(numberSetting(values.desktopLyricSaturation, 1), 0, 2),
    visibleLines: Math.max(
      0,
      Math.min(
        99,
        Math.round(numberSetting(values.desktopLyricVisibleLines, 0)),
      ),
    ),
  };
}

export function resolveLyricTime(currentMs, settings) {
  const number = Number(currentMs);
  const offset = Number(settings?.timeOffsetMs);
  return Math.max(
    0,
    (Number.isFinite(number) ? number : 0) +
      (Number.isFinite(offset) ? offset : 0),
  );
}

export function resolveNoLyricText(timeline, settings, defaults = {}) {
  const title = String(timeline?.trackTitle || '').trim();
  if (settings?.showTitleWhenNoLyric && title) return title;
  return (
    String(settings?.noLyricText || defaults.desktopLyricNoLyricText).trim() ||
    defaults.desktopLyricNoLyricText
  );
}
