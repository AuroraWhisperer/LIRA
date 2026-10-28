// Edit this contract; sync-danmaku-style-options.cjs generates the local Node mirror.
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
const TWITTER_COMPOSER_TEXT_DEFAULT = '欢迎来到直播间 ✨';
const TWITTER_COMPOSER_TEXT_MAX_LENGTH = 20;
const TWITTER_LAYOUT_DEFAULTS = Object.freeze({ twitterHeader: 'show', twitterComposer: 'show', twitterActions: 'show' });
const TWITTER_COLOR_DEFAULTS = Object.freeze({
  twitterColor0: '#409afa', twitterColor50: '#f9c844', twitterColor100: '#f89260', twitterColor1000: '#ef4260',
});
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
    composerText: true,
    twitterOptions: true,
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

// One field contract feeds validation and every parameter editor. Groups only change presentation.
const DANMAKU_OPTION_FIELDS = Object.freeze({
  fontFamily: { label: '字体', type: 'font', default: 'default', defaultKey: 'defaultFontFamily' },
  fontSize: { label: '正文字号', type: 'number', default: 30, defaultKey: 'defaultFontSize', minKey: 'minFontSize', maxKey: 'maxFontSize' },
  textColor: { label: '正文颜色', type: 'color', alpha: true, default: '#eaf2ff', defaultKey: 'defaultTextColor' },
  backgroundOpacity: { label: '背景不透明度', type: 'number', input: 'range', min: 0, max: 100, default: 100, capability: 'background', unit: '%' },
  scrollDirection: { label: '滚动方向', type: 'select', default: 'up', capability: 'scrollDirection', choices: [['up', '从下向上（新弹幕在底部）'], ['down', '从上向下（新弹幕在顶部）']] },
  edgeFade: { label: '边缘处理', type: 'select', default: 'single', defaultKey: 'defaultEdgeFade', capability: 'scrollDirection', legacy: ['single'],
    help: '可选择上下两端、仅上边或仅下边渐隐；选定的边缘不随滚动方向改变。',
    choices: [['both', '两端渐隐'], ['top', '上边渐隐'], ['bottom', '下边渐隐'], ['none', '直接切断']] },
  durationSeconds: { label: '停留（秒）', type: 'number', min: 2, max: 30, default: 6, layout: 'fullscreen-random', control: 'fullscreenDurationSeconds' },
  speedPixelsPerSecond: { label: '飘动速度', type: 'number', input: 'range', min: 20, max: 600, default: 120, capability: 'speed', control: 'floatingSpeed',
    help: '1～100，默认 50 为原速；1 为原速的三分之一，100 为原速的三倍。超出刻度范围的旧速度会保留，手动调节后按新刻度保存。' },
  floatingDispersion: { label: '分散程度', type: 'number', input: 'range', min: 1, max: 100, default: 50, layout: 'floating',
    help: '数值越大，新弹幕越倾向于远离画面中的其他弹幕。拥挤时以可用空间为准，已显示弹幕不换位置。' },
  bubbleColor: { label: '弹幕配色', type: 'color', alpha: true, allowDefault: true, default: 'default', capability: 'bubbleColor' },
  giftImage: { label: '礼物图片', type: 'select', default: 'theme', capability: 'giftImage', choices: [['theme', '样式插画'], ['gift', '真实礼物图片']], group: 'message' },
  minGiftAmount: { label: '弹幕礼物卡片最低金额', type: 'number', min: 0, max: 100000, step: 0.01, default: 0, capability: 'minGiftAmount', group: 'message',
    help: '按单条已结算人民币总额筛选，包含上舰。0 显示全部；SC 不受影响。' },
  composerText: { label: '底部提示文字', type: 'text', default: TWITTER_COMPOSER_TEXT_DEFAULT, capability: 'composerText', maxLength: TWITTER_COMPOSER_TEXT_MAX_LENGTH },
  ...Object.fromEntries(Object.entries(TWITTER_LAYOUT_DEFAULTS).map(([key, value], index) => [key, {
    label: ['顶部资料区', '底部提示栏', '操作图标行'][index], type: 'select', default: value, capability: 'twitterOptions', choices: [['show', '显示'], ['hide', '隐藏']],
  }])),
  ...Object.fromEntries(Object.entries(TWITTER_COLOR_DEFAULTS).map(([key, value], index) => [key, {
    label: ['＜50 元', '50～99.99 元', '100～999.99 元', '≥1000 元'][index], type: 'color', alpha: true, default: value, capability: 'twitterOptions', group: 'twitterColors',
  }])),
  spookyTheme: { label: '便笺配色', type: 'select', default: 'default', capability: 'spookyOptions', choices: [['default', 'Default · 紫色'], ['autumn', 'Autumn · 秋日'], ['graveyard', 'Graveyard · 灰紫'], ['moonlight', 'Moonlight · 月光']] },
  spookyFrame: { label: 'Chat Box 外框', type: 'select', default: 'show', capability: 'spookyOptions', choices: [['show', '显示'], ['hide', '隐藏']] },
  ...Object.fromEntries(SPOOKY_COLOR_KEYS.filter(key => key !== 'textColor').map((key, index) => [key, {
    label: ['外框底色', '消息底色', '事件卡底色', '装饰强调色'][index], type: 'color', alpha: true, allowDefault: true, default: 'default', capability: 'spookyOptions', group: 'spookyColors',
  }])),
  ...Object.fromEntries(SPOOKY_OPACITY_KEYS.map((key, index) => [key, {
    label: ['外框不透明度', '消息不透明度', '事件不透明度'][index], type: 'number', input: 'range', min: 0, max: 100, default: 100, unit: '%', capability: 'spookyOptions', group: 'spookyColors',
  }])),
  ...Object.fromEntries(Object.entries(RIPPLOID_COLOR_DEFAULTS).map(([key, value], index) => [key, {
    label: key.startsWith('guard') ? ['舰长', '提督', '总督'][index - 6]
      : ['＜50 元', '50～＜100 元', '100～＜500 元', '500～＜1000 元', '1000～＜2000 元', '≥2000 元'][index < 6 ? index : index - 9],
    type: 'color', default: value, capability: 'ripploidColors',
    group: key.startsWith('gift') ? 'ripploidGift' : key.startsWith('guard') ? 'ripploidGuard' : 'ripploidSuperchat',
  }])),
  decorationShape: { label: '装饰图案', type: 'select', default: 'sparkle', capability: 'decorationShape', help: '每种图案搭配自己的轻动画，切换图案即可预览。',
    choices: [['sparkle', '四角星'], ['heart', '爱心'], ['square', '圆角方块'], ['star', '五角星'], ['flower', '小花'], ['moon', '月牙'], ['bow', '蝴蝶结']] },
  entranceAnimation: { label: '入场动画', type: 'select', default: 'fade', capability: 'entranceAnimation', choices: [['fade', '动画 1 · 渐显'], ['rise', '动画 2 · 上浮弹入']] },
  centerBias: { label: '中心倾向', type: 'number', input: 'range', min: 1, max: 50, default: 1, layout: 'fullscreen-random', group: 'distribution' },
  dispersion: { label: '离散程度', type: 'number', input: 'range', min: 1, max: 50, default: 1, layout: 'fullscreen-random', group: 'distribution' },
});
const REAL_GIFT_STYLES = Object.freeze(['identity', 'transparent', 'outline', 'bubble', 'cream', 'twitter']);
const STYLE_OPTION_FIELDS = Object.fromEntries(Object.entries(DANMAKU_STYLE_OPTIONS).map(([style, limits]) => [style,
  Object.fromEntries(Object.entries(DANMAKU_OPTION_FIELDS)
    .filter(([, field]) => (!field.capability || limits[field.capability]) && (!field.layout || limits.layout === field.layout))
    .map(([key, field]) => [key, Object.freeze({ ...field,
      default: limits[field.defaultKey] ?? field.default,
      ...(field.minKey ? { min: limits[field.minKey], max: limits[field.maxKey] } : {}),
    })])),
]));

function styleOptionFields(style) {
  return STYLE_OPTION_FIELDS[style] || {};
}

const composerSegments = new Intl.Segmenter('zh', { granularity: 'grapheme' });
function inspectComposerText(value) {
  const text = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  const length = Array.from(composerSegments.segment(text)).length;
  const error = typeof value !== 'string' ? '请输入文字。'
    : /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) ? '底部提示文字不能包含换行或控制字符。'
      : length > TWITTER_COMPOSER_TEXT_MAX_LENGTH ? `底部提示文字最多 ${TWITTER_COMPOSER_TEXT_MAX_LENGTH} 个字。` : '';
  return { text, length, error };
}

function normalizeStyleOptions(value) {
  const fail = () => { throw Object.assign(new Error('INVALID_OVERLAY_OPTIONS'), { code: 'INVALID_OVERLAY_OPTIONS' }); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = {};
  for (const [style, options] of Object.entries(value)) {
    if (!Object.hasOwn(DANMAKU_STYLE_OPTIONS, style) || !options || typeof options !== 'object' || Array.isArray(options)) fail();
    const fields = styleOptionFields(style);
    const normalized = {};
    for (const [key, item] of Object.entries(options)) {
      if (!Object.hasOwn(fields, key)) fail();
      const field = fields[key];
      if (field.type === 'number') {
        if (!Number.isFinite(item) || item < field.min || item > field.max
          || (field.step === 0.01 ? Number(item.toFixed(2)) !== item : !Number.isInteger(item))) fail();
        normalized[key] = item;
      } else if (field.type === 'select') {
        if (!field.choices.some(([value]) => value === item) && !field.legacy?.includes(item)) fail();
        normalized[key] = item;
      } else if (field.type === 'color') {
        const color = typeof item === 'string' && (item.length === 7 || field.alpha && item.length === 9)
          && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(item);
        if (!color && !(field.allowDefault && item === 'default')) fail();
        normalized[key] = item.toLowerCase();
      } else if (field.type === 'font') {
        if (typeof item !== 'string' || !(Object.hasOwn(DANMAKU_FONTS, item) || item.length <= 402
          && /^"(?:[^"\\\u0000-\u001f\u007f]|\\["\\])+"$/u.test(item)
          && !/[\u0000-\u001f\u007f]|^"\s*"$/u.test(item))) fail();
        normalized[key] = item;
      } else if (field.type === 'text') {
        const inspected = inspectComposerText(item);
        if (inspected.error) fail();
        if (inspected.text) normalized[key] = inspected.text;
      }
    }
    result[style] = normalized;
  }
  return result;
}
function styleOptionsFor(style, options = {}, legacyDurationSeconds = 6) {
  const fields = styleOptionFields(style);
  const defaults = {
    textColor: '#eaf2ff', fontFamily: 'default', fontSize: 30,
    backgroundOpacity: 100, giftImage: 'theme', scrollDirection: 'up',
    ...Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.default])),
  };
  if (fields.durationSeconds && Number.isInteger(legacyDurationSeconds)
    && legacyDurationSeconds >= fields.durationSeconds.min && legacyDurationSeconds <= fields.durationSeconds.max) {
    defaults.durationSeconds = legacyDurationSeconds;
  }
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
  if (REAL_GIFT_STYLES.includes(style)) resolved.giftImage = 'gift';
  if (resolved.edgeFade === 'single') {
    resolved.edgeFade = resolved.scrollDirection === 'down' ? 'bottom' : 'top';
  }
  return resolved;
}

module.exports = { DANMAKU_OPTION_FIELDS, REAL_GIFT_STYLES, styleOptionFields, DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, RIPPLOID_COLOR_DEFAULTS, SPOOKY_THEME_COLORS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, TWITTER_COMPOSER_TEXT_DEFAULT, TWITTER_COMPOSER_TEXT_MAX_LENGTH, TWITTER_LAYOUT_DEFAULTS, TWITTER_COLOR_DEFAULTS, inspectComposerText, normalizeStyleOptions, styleOptionsFor };
