// Shared display contract; keep desktop/server browser and Node copies in sync.
const DANMAKU_STYLE_OPTIONS = Object.freeze({
  bubble: { label: '聊天气泡', minFontSize: 18, maxFontSize: 48, background: true, giftImage: true },
  signal: { label: '深色面板', minFontSize: 18, maxFontSize: 48, background: true, giftImage: true },
  minimal: { label: '蝴蝶结', minFontSize: 18, maxFontSize: 40, background: false, giftImage: false },
  ranked: { label: '经典样式', minFontSize: 20, maxFontSize: 44, background: true, giftImage: true },
  transparent: { label: '透明文字', minFontSize: 18, maxFontSize: 56, background: false, giftImage: true },
  identity: { label: '头像横卡', minFontSize: 18, maxFontSize: 42, background: true, giftImage: true },
  outline: { label: '简洁白卡', minFontSize: 18, maxFontSize: 40, background: true, giftImage: true },
  cream: { label: '奶油气泡', minFontSize: 18, maxFontSize: 40, background: true, giftImage: true },
  glow: { label: '流光气泡', minFontSize: 18, maxFontSize: 40, background: true, giftImage: false },
});
const DANMAKU_FONTS = Object.freeze({
  default: '',
  sans: "'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
  serif: "'SimSun', 'Songti SC', serif",
  kai: "'KaiTi', 'STKaiti', serif",
});

function normalizeStyleOptions(value) {
  const fail = () => { throw Object.assign(new Error('INVALID_OVERLAY_OPTIONS'), { code: 'INVALID_OVERLAY_OPTIONS' }); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = {};
  for (const [style, options] of Object.entries(value)) {
    if (!Object.hasOwn(DANMAKU_STYLE_OPTIONS, style) || !options ||
        typeof options !== 'object' || Array.isArray(options)) fail();
    const limits = DANMAKU_STYLE_OPTIONS[style];
    const normalized = {};
    for (const [key, item] of Object.entries(options)) {
      if (key === 'fontFamily' && Object.hasOwn(DANMAKU_FONTS, item) && typeof item === 'string') normalized[key] = item;
      else if (key === 'fontSize' && Number.isInteger(item) && item >= limits.minFontSize && item <= limits.maxFontSize) normalized[key] = item;
      else if (key === 'backgroundOpacity' && limits.background && Number.isInteger(item) && item >= 0 && item <= 100) normalized[key] = item;
      else if (key === 'giftImage' && limits.giftImage && ['theme', 'gift'].includes(item)) normalized[key] = item;
      else fail();
    }
    result[style] = normalized;
  }
  return result;
}

function styleOptionsFor(style, options = {}) {
  const defaults = { fontFamily: 'default', fontSize: 30, backgroundOpacity: 100, giftImage: 'theme' };
  try { return { ...defaults, ...normalizeStyleOptions({ [style]: options[style] || {} })[style] }; }
  catch { return defaults; }
}

module.exports = { DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, normalizeStyleOptions, styleOptionsFor };
