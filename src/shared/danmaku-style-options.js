// Shared display contract; keep desktop/server browser and Node copies in sync.
const DANMAKU_STYLE_OPTIONS = Object.freeze({
  bubble: {
    scrollDirection: true,
    label: '聊天气泡',
    minFontSize: 18,
    maxFontSize: 48,
    background: true,
    giftImage: true,
    defaultTextColor: '#eaf2ff',
  },
  signal: {
    scrollDirection: true,
    label: '深色面板',
    minFontSize: 18,
    maxFontSize: 48,
    background: true,
    giftImage: true,
    defaultTextColor: '#eaf2ff',
  },
  minimal: {
    scrollDirection: true,
    label: '蝴蝶结',
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
    label: '透明文字',
    minFontSize: 18,
    maxFontSize: 56,
    background: false,
    giftImage: true,
    defaultTextColor: '#ffffff',
  },
  identity: {
    scrollDirection: true,
    label: '头像横卡',
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
  prismatic: {
    scrollDirection: true,
    label: '柔彩气泡',
    minFontSize: 18,
    maxFontSize: 48,
    background: false,
    giftImage: false,
    defaultTextColor: '#292b32',
  },
  starlight: {
    scrollDirection: true,
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
    label: '简洁白卡',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: true,
    defaultTextColor: '#1d1d1f',
  },
  whiteframe: {
    layout: 'fullscreen-random',
    label: '白线框',
    minFontSize: 18,
    maxFontSize: 40,
    background: false,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
  cream: {
    layout: 'fullscreen-random',
    label: '奶油气泡',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: true,
    defaultTextColor: '#584941',
  },
  floating: {
    layout: 'floating',
    label: '飘窗弹幕',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    speed: true,
    defaultTextColor: '#ffffff',
  },
  comet: {
    layout: 'floating',
    label: '鹤映鎏金',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    speed: true,
    defaultTextColor: '#c29670',
  },
  starveil: {
    layout: 'fullscreen-random',
    label: '星幕浮语',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
  glow: {
    layout: 'fullscreen-random',
    label: '流光气泡',
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
      else if (key === 'textColor' && typeof item === 'string' && /^#[0-9a-f]{6}$/i.test(item) && item.length === 7)
        normalized[key] = item.toLowerCase();
      else if (key === 'fontSize' && Number.isInteger(item) && item >= limits.minFontSize && item <= limits.maxFontSize)
        normalized[key] = item;
      else if (key === 'backgroundOpacity' && limits.background && Number.isInteger(item) && item >= 0 && item <= 100)
        normalized[key] = item;
      else if (key === 'giftImage' && limits.giftImage && ['theme', 'gift'].includes(item)) normalized[key] = item;
      else if (key === 'scrollDirection' && limits.scrollDirection && ['up', 'down'].includes(item))
        normalized[key] = item;
      else if (key === 'speedPixelsPerSecond' && limits.speed && Number.isInteger(item) && item >= 20 && item <= 600)
        normalized[key] = item;
      else if (['centerBias', 'dispersion'].includes(key) && limits.layout === 'fullscreen-random'
        && Number.isInteger(item) && item >= 1 && item <= 50) normalized[key] = item;
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
    backgroundOpacity: 100,
    giftImage: 'theme',
    scrollDirection: 'up',
    ...(DANMAKU_STYLE_OPTIONS[style]?.layout === 'fullscreen-random' ? { centerBias: 1, dispersion: 1 } : {}),
    ...(DANMAKU_STYLE_OPTIONS[style]?.speed ? { speedPixelsPerSecond: 120 } : {}),
  };
  try {
    return { ...defaults, ...normalizeStyleOptions({ [style]: options[style] || {} })[style] };
  } catch {
    return defaults;
  }
}

module.exports = { DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, normalizeStyleOptions, styleOptionsFor };
