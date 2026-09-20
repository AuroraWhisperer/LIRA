// Shared display contract; keep desktop/server browser and Node copies in sync.
const DANMAKU_STYLE_OPTIONS = Object.freeze({
  bubble: { label: '聊天气泡', minFontSize: 18, maxFontSize: 48, background: true, giftImage: true, defaultTextColor: '#eaf2ff' },
  signal: { label: '深色面板', minFontSize: 18, maxFontSize: 48, background: true, giftImage: true, defaultTextColor: '#eaf2ff' },
  minimal: { label: '蝴蝶结', minFontSize: 18, maxFontSize: 40, background: false, giftImage: false, defaultTextColor: '#f7f9ff' },
  ranked: { label: '经典样式', minFontSize: 20, maxFontSize: 44, background: true, giftImage: true, defaultTextColor: '#ffffff' },
  transparent: { label: '透明文字', minFontSize: 18, maxFontSize: 56, background: false, giftImage: true, defaultTextColor: '#ffffff' },
  identity: { label: '头像横卡', minFontSize: 18, maxFontSize: 42, background: true, giftImage: true, defaultTextColor: '#ffffff' },
  outline: { label: '简洁白卡', minFontSize: 18, maxFontSize: 40, background: true, giftImage: true, defaultTextColor: '#1d1d1f' },
  cream: { label: '奶油气泡', minFontSize: 18, maxFontSize: 40, background: true, giftImage: true, defaultTextColor: '#584941' },
  glow: { label: '流光气泡', minFontSize: 18, maxFontSize: 40, background: true, giftImage: false, defaultTextColor: '#ffffff' },
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
      if (key === 'fontFamily' && typeof item === 'string' &&
          (Object.hasOwn(DANMAKU_FONTS, item) || (item.length <= 402 &&
            /^"(?:[^"\\\u0000-\u001f\u007f]|\\["\\])+"$/u.test(item) && !/[\u0000-\u001f\u007f]|^"\s*"$/u.test(item)))) normalized[key] = item;
      else if (key === 'textColor' && typeof item === 'string' && /^#[0-9a-f]{6}$/i.test(item) && item.length === 7) normalized[key] = item.toLowerCase();
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
  const defaults = { textColor: DANMAKU_STYLE_OPTIONS[style]?.defaultTextColor || '#eaf2ff', fontFamily: 'default', fontSize: 30, backgroundOpacity: 100, giftImage: 'theme' };
  try { return { ...defaults, ...normalizeStyleOptions({ [style]: options[style] || {} })[style] }; }
  catch { return defaults; }
}

module.exports = { DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, normalizeStyleOptions, styleOptionsFor };
