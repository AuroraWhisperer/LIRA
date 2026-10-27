// Shared display contract; keep desktop/server browser and Node copies in sync.
// RIPPLOID uses the existing SC price bands for its six gift/SC color tiers.
const RIPPLOID_COLOR_DEFAULTS = Object.freeze({
  giftColor0: '#f39749', giftColor50: '#f39749', giftColor100: '#f39749',
  giftColor500: '#f39749', giftColor1000: '#f39749', giftColor2000: '#f39749',
  guardColorCaptain: '#f39749', guardColorAdmiral: '#f39749', guardColorGovernor: '#f39749',
  superchatColor0: '#f39749', superchatColor50: '#f39749', superchatColor100: '#f39749',
  superchatColor500: '#f39749', superchatColor1000: '#f39749', superchatColor2000: '#f39749',
});
const SPOOKY_THEME_COLORS = Object.freeze({
  default: { spookyFrameColor: '#2d204e', spookyMessageColor: '#2e154e', textColor: '#fce6fa', spookyEventColor: '#382459', spookyAccentColor: '#9c62e4' },
  autumn: { spookyFrameColor: '#5b2d29', spookyMessageColor: '#592929', textColor: '#fff1d1', spookyEventColor: '#72362b', spookyAccentColor: '#c65c54' },
  graveyard: { spookyFrameColor: '#322b3d', spookyMessageColor: '#2b2237', textColor: '#f3e9fa', spookyEventColor: '#3a3247', spookyAccentColor: '#8584b5' },
  moonlight: { spookyFrameColor: '#25283e', spookyMessageColor: '#1a2038', textColor: '#edf0ff', spookyEventColor: '#2e3154', spookyAccentColor: '#7776d6' },
});
const SPOOKY_COLOR_KEYS = Object.freeze(Object.keys(SPOOKY_THEME_COLORS.default));
const SPOOKY_OPACITY_KEYS = Object.freeze(['spookyFrameOpacity', 'spookyMessageOpacity', 'spookyEventOpacity']);
const DANMAKU_STYLE_OPTIONS = Object.freeze({
  bubble: {
    scrollDirection: true,
    label: '琉璃',
    minFontSize: 18,
    maxFontSize: 48,
    background: true,
    giftImage: true,
    defaultTextColor: '#eaf2ff',
  },
  signal: {
    scrollDirection: true,
    label: '青墨笺',
    minFontSize: 18,
    maxFontSize: 48,
    background: true,
    giftImage: true,
    defaultTextColor: '#eaf2ff',
  },
  minimal: {
    scrollDirection: true,
    label: '蝶恋花',
    minFontSize: 18,
    maxFontSize: 40,
    background: false,
    giftImage: false,
    defaultTextColor: '#f7f9ff',
  },
  ranked: {
    scrollDirection: true,
    label: '经典样式',
    minFontSize: 20,
    maxFontSize: 44,
    background: true,
    giftImage: true,
    defaultTextColor: '#ffffff',
  },
  transparent: {
    scrollDirection: true,
    label: '留白',
    minFontSize: 18,
    maxFontSize: 56,
    background: false,
    giftImage: true,
    defaultTextColor: '#ffffff',
  },
  identity: {
    scrollDirection: true,
    label: '灵动弹幕',
    minFontSize: 18,
    maxFontSize: 42,
    background: true,
    giftImage: true,
    defaultTextColor: '#ffffff',
  },
  sketch: {
    scrollDirection: true,
    label: '绿萌简笔画',
    minFontSize: 18,
    maxFontSize: 48,
    background: true,
    giftImage: false,
    defaultTextColor: '#7f9f76',
  },
  harbor: {
    scrollDirection: true,
    label: '对白',
    minFontSize: 18,
    maxFontSize: 48,
    background: true,
    giftImage: false,
    minGiftAmount: true,
    defaultTextColor: '#ffffff',
  },
  prismatic: {
    scrollDirection: true,
    defaultEdgeFade: 'both',
    label: '流霞',
    minFontSize: 18,
    maxFontSize: 48,
    background: false,
    giftImage: false,
    defaultTextColor: '#292b32',
  },
  snowfox: {
    scrollDirection: true,
    label: '雪狐物语',
    minFontSize: 18,
    maxFontSize: 48,
    background: false,
    giftImage: false,
    bubbleColor: true,
    defaultTextColor: '#78a9d6',
  },
  ripploid: {
    scrollDirection: true,
    label: 'RIPPLOID',
    minFontSize: 18,
    maxFontSize: 48,
    defaultFontSize: 24,
    background: false,
    giftImage: false,
    bubbleColor: true,
    ripploidColors: true,
    defaultBubbleColor: '#eb945e',
    defaultTextColor: '#f5f5f5',
  },
  notebook: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '手账风',
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 23,
    background: false, giftImage: false, defaultTextColor: '#3e3e3d',
  },
  spooky: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '幽灵便笺',
    minFontSize: 16, maxFontSize: 36, defaultFontSize: 20,
    background: false, giftImage: false, spookyOptions: true,
    defaultTextColor: '#fce6fa',
  },
  twitter: {
    scrollDirection: true,
    defaultEdgeFade: 'none',
    label: '仿推特 3.0',
    minFontSize: 18,
    maxFontSize: 40,
    defaultFontSize: 22,
    background: false,
    giftImage: true,
    defaultTextColor: '#141414',
  },
  'flower-letter': {
    scrollDirection: true,
    defaultEdgeFade: 'none',
    label: '花与信笺',
    minFontSize: 18,
    maxFontSize: 40,
    defaultFontSize: 24,
    defaultFontFamily: '"Lira Yozai"',
    background: true,
    giftImage: false,
    defaultTextColor: '#766449',
  },
  starlight: {
    scrollDirection: true,
    decorationShape: true,
    label: '星语',
    minFontSize: 18,
    maxFontSize: 48,
    background: false,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
  moonlit: {
    scrollDirection: true,
    label: '月渡花汀',
    minFontSize: 18,
    maxFontSize: 42,
    background: true,
    giftImage: true,
    defaultTextColor: '#fffaf2',
  },
  outline: {
    layout: 'fullscreen-random',
    label: '一纸素笺',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: true,
    defaultTextColor: '#1d1d1f',
  },
  mist: {
    layout: 'fullscreen-random',
    label: '青雾',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
  whiteframe: {
    layout: 'fullscreen-random',
    entranceAnimation: true,
    label: '白描',
    minFontSize: 18,
    maxFontSize: 40,
    background: false,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
  cream: {
    layout: 'fullscreen-random',
    label: '杏花白',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: true,
    defaultTextColor: '#584941',
  },
  floating: {
    layout: 'floating',
    label: '浮光掠影',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    speed: true,
    defaultTextColor: '#ffffff',
  },
  comet: {
    layout: 'floating',
    label: '鹤舞花枝间',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    speed: true,
    defaultTextColor: '#c29670',
  },
  starveil: {
    layout: 'fullscreen-random',
    entranceAnimation: true,
    label: '点点流萤',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
  glow: {
    layout: 'fullscreen-random',
    entranceAnimation: true,
    label: '流光溢彩',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
});
const DANMAKU_FONTS = Object.freeze({
  default: '',
  sans: "'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
  serif: "'SimSun', 'Songti SC', serif",
  kai: "'KaiTi', 'STKaiti', serif",
});

function normalizeStyleOptions(value) {
  const fail = () => {
    throw Object.assign(new Error('INVALID_OVERLAY_OPTIONS'), { code: 'INVALID_OVERLAY_OPTIONS' });
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = {};
  for (const [style, options] of Object.entries(value)) {
    if (
      !Object.hasOwn(DANMAKU_STYLE_OPTIONS, style) ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options)
    )
      fail();
    const limits = DANMAKU_STYLE_OPTIONS[style];
    const normalized = {};
    for (const [key, item] of Object.entries(options)) {
      if (
        key === 'fontFamily' &&
        typeof item === 'string' &&
        (Object.hasOwn(DANMAKU_FONTS, item) ||
          (item.length <= 402 &&
            /^"(?:[^"\\\u0000-\u001f\u007f]|\\["\\])+"$/u.test(item) &&
            !/[\u0000-\u001f\u007f]|^"\s*"$/u.test(item)))
      )
        normalized[key] = item;
      else if (key === 'textColor' && typeof item === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(item) && [7, 9].includes(item.length))
        normalized[key] = item.toLowerCase();
      else if (key === 'fontSize' && Number.isInteger(item) && item >= limits.minFontSize && item <= limits.maxFontSize)
        normalized[key] = item;
      else if (key === 'backgroundOpacity' && limits.background && Number.isInteger(item) && item >= 0 && item <= 100)
        normalized[key] = item;
      else if (key === 'giftImage' && limits.giftImage && ['theme', 'gift'].includes(item)) normalized[key] = item;
      else if (key === 'decorationShape' && limits.decorationShape
        && ['sparkle', 'heart', 'square', 'star', 'flower', 'moon', 'bow'].includes(item)) normalized[key] = item;
      else if (key === 'entranceAnimation' && limits.entranceAnimation && ['fade', 'rise'].includes(item))
        normalized[key] = item;
      else if (key === 'scrollDirection' && limits.scrollDirection && ['up', 'down'].includes(item))
        normalized[key] = item;
      else if (key === 'edgeFade' && limits.scrollDirection && ['both', 'top', 'bottom', 'single', 'none'].includes(item))
        normalized[key] = item;
      else if (key === 'speedPixelsPerSecond' && limits.speed && Number.isInteger(item) && item >= 20 && item <= 600)
        normalized[key] = item;
      else if (key === 'floatingDispersion' && limits.layout === 'floating'
        && Number.isInteger(item) && item >= 1 && item <= 100) normalized[key] = item;
      else if (['centerBias', 'dispersion'].includes(key) && limits.layout === 'fullscreen-random'
        && Number.isInteger(item) && item >= 1 && item <= 50) normalized[key] = item;
      else if (key === 'bubbleColor' && limits.bubbleColor && typeof item === 'string'
        && (item === 'default' || ([7, 9].includes(item.length) && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(item))))
        normalized[key] = item.toLowerCase();
      else if (limits.ripploidColors && Object.hasOwn(RIPPLOID_COLOR_DEFAULTS, key)
        && typeof item === 'string' && /^#[0-9a-f]{6}$/i.test(item)) normalized[key] = item.toLowerCase();
      else if (key === 'spookyTheme' && limits.spookyOptions
        && ['default', 'autumn', 'graveyard', 'moonlight'].includes(item)) normalized[key] = item;
      else if (key === 'spookyFrame' && limits.spookyOptions && ['show', 'hide'].includes(item)) normalized[key] = item;
      else if (limits.spookyOptions && key !== 'textColor' && SPOOKY_COLOR_KEYS.includes(key) && typeof item === 'string'
        && (item === 'default' || ([7, 9].includes(item.length) && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(item)))) normalized[key] = item.toLowerCase();
      else if (limits.spookyOptions && SPOOKY_OPACITY_KEYS.includes(key)
        && Number.isInteger(item) && item >= 0 && item <= 100) normalized[key] = item;
      else if (key === 'minGiftAmount' && limits.minGiftAmount && Number.isFinite(item)
        && item >= 0 && item <= 100000 && Number(item.toFixed(2)) === item) normalized[key] = item;
      else fail();
    }
    result[style] = normalized;
  }
  return result;
}

function styleOptionsFor(style, options = {}) {
  const defaults = {
    textColor: DANMAKU_STYLE_OPTIONS[style]?.defaultTextColor || '#eaf2ff',
    fontFamily: DANMAKU_STYLE_OPTIONS[style]?.defaultFontFamily || 'default',
    fontSize: DANMAKU_STYLE_OPTIONS[style]?.defaultFontSize || 30,
    ...(DANMAKU_STYLE_OPTIONS[style]?.minGiftAmount ? { minGiftAmount: 0 } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.bubbleColor ? { bubbleColor: 'default' } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.ripploidColors ? RIPPLOID_COLOR_DEFAULTS : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.decorationShape ? { decorationShape: 'sparkle' } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.entranceAnimation ? { entranceAnimation: 'fade' } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.spookyOptions ? {
      spookyTheme: 'default', spookyFrame: 'show',
      spookyFrameColor: 'default', spookyMessageColor: 'default', spookyEventColor: 'default', spookyAccentColor: 'default',
      spookyFrameOpacity: 100, spookyMessageOpacity: 100, spookyEventOpacity: 100,
    } : {}),
    backgroundOpacity: 100,
    giftImage: 'theme',
    scrollDirection: 'up',
    ...(DANMAKU_STYLE_OPTIONS[style]?.scrollDirection
      ? { edgeFade: DANMAKU_STYLE_OPTIONS[style].defaultEdgeFade || 'single' } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.layout === 'fullscreen-random' ? { centerBias: 1, dispersion: 1 } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.speed ? { speedPixelsPerSecond: 120, floatingDispersion: 50 } : {}),
  };
  let resolved = defaults;
  try {
    resolved = { ...defaults, ...normalizeStyleOptions({ [style]: options[style] || {} })[style] };
  } catch {
    resolved = defaults;
  }
  if (style === 'spooky' && !Object.hasOwn(options[style] || {}, 'textColor')) {
    resolved.textColor = SPOOKY_THEME_COLORS[resolved.spookyTheme].textColor;
  }
  // Keep accepting legacy image options while these styles always show the gift itself.
  if (['identity', 'transparent', 'outline', 'bubble', 'cream', 'twitter'].includes(style)) resolved.giftImage = 'gift';
  if (resolved.edgeFade === 'single') {
    resolved.edgeFade = resolved.scrollDirection === 'down' ? 'bottom' : 'top';
  }
  return resolved;
}

export { DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, RIPPLOID_COLOR_DEFAULTS, SPOOKY_THEME_COLORS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, normalizeStyleOptions, styleOptionsFor };

export function isRandomDanmakuStyle(style) {
  return DANMAKU_STYLE_OPTIONS[style]?.layout === 'fullscreen-random';
}

export function isFloatingDanmakuStyle(style) {
  return DANMAKU_STYLE_OPTIONS[style]?.layout === 'floating';
}

export function applyStyleOptions(document, style, allOptions) {
  const options = styleOptionsFor(style, allOptions);
  document.body.dataset.scrollDirection = options.scrollDirection;
  document.body.dataset.edgeFade = options.edgeFade || 'none';
  document.body.dataset.entranceAnimation = options.entranceAnimation || 'fade';
  document.body.dataset.decorationShape = options.decorationShape || 'sparkle';
  document.body.dataset.spookyTheme = options.spookyTheme || 'default';
  document.body.dataset.spookyFrame = options.spookyFrame || 'show';
  const root = document.documentElement.style;
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

export function parseStyleOptions(value) {
  try {
    return normalizeStyleOptions(JSON.parse(value || '{}'));
  } catch {
    return {};
  }
}
