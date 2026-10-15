// Shared display contract; keep desktop/server browser and Node copies in sync.
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
    fontFamily: 'default',
    fontSize: 30,
    ...(DANMAKU_STYLE_OPTIONS[style]?.minGiftAmount ? { minGiftAmount: 0 } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.bubbleColor ? { bubbleColor: 'default' } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.decorationShape ? { decorationShape: 'sparkle' } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.entranceAnimation ? { entranceAnimation: 'fade' } : {}),
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
  // Keep accepting legacy image options while these styles always show the gift itself.
  if (['identity', 'transparent', 'outline'].includes(style)) resolved.giftImage = 'gift';
  if (resolved.edgeFade === 'single') {
    resolved.edgeFade = resolved.scrollDirection === 'down' ? 'bottom' : 'top';
  }
  return resolved;
}

module.exports = { DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, normalizeStyleOptions, styleOptionsFor };
