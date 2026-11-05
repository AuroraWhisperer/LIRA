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
  christmas: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '圣诞绮笺',
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 24,
    background: true, giftImage: false, bubbleColor: true, ambientMotion: true,
    defaultBubbleColor: '#782632', defaultTextColor: '#fff1d8',
  },
  'christmas-letter': {
    scrollDirection: true, defaultEdgeFade: 'none', label: '圣诞来信',
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 24,
    background: true, giftImage: false, defaultTextColor: '#725244',
  },
  notebook: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '手账风',
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 23,
    background: false, giftImage: false, ambientMotion: true, defaultTextColor: '#3e3e3d',
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
    ambientMotion: true,
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
    entranceAnimation: true,
    label: '一纸素笺',
    minFontSize: 18,
    maxFontSize: 40,
    background: true,
    giftImage: true,
    defaultTextColor: '#1d1d1f',
  },
  comic: {
    layout: 'fullscreen-random', label: '漫画对白',
    minFontSize: 18, maxFontSize: 42, defaultFontSize: 26, defaultFontFamily: 'serif',
    background: true, giftImage: false, comicOptions: true, defaultTextColor: '#292626',
  },
  mist: {
    layout: 'fullscreen-random',
    entranceAnimation: true,
    defaultEntranceMs: 280,
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
    bubbleColor: true,
    defaultBubbleColor: '#ffffffd9',
    label: '白描',
    minFontSize: 18,
    maxFontSize: 40,
    background: false,
    giftImage: false,
    defaultTextColor: '#ffffff',
  },
  cream: {
    layout: 'fullscreen-random',
    entranceAnimation: true,
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
  aurora: {
    layout: 'floating', label: '极光薄笺',
    defaultFloatingEdgeFade: 'both',
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 26,
    background: true, giftImage: false, speed: true, ambientMotion: true, auroraOptions: true,
    defaultTextColor: '#514365',
  },
  startrail: {
    layout: 'floating', label: '星轨飞语',
    defaultFloatingEdgeFade: 'both',
    minFontSize: 18, maxFontSize: 44, defaultFontSize: 28,
    background: false, giftImage: false, speed: true,
    ambientMotion: true, startrailOptions: true,
    defaultTextColor: '#f1f6ff',
  },
  starveil: {
    layout: 'fullscreen-random',
    entranceAnimation: true,
    defaultEntranceMs: 260,
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
  fontSize: { label: '正文字号', type: 'number', default: 30, defaultKey: 'defaultFontSize', minKey: 'minFontSize', maxKey: 'maxFontSize', help: '调整正文和行内表情，气泡随内容自动增高。头像、头像框、昵称、徽章和装饰保持本款尺寸；礼物及上舰文案保留各款排版比例。需要整套放大或缩小，请在画布中缩放组件。' },
  textColor: { label: '正文颜色', type: 'color', alpha: true, default: '#eaf2ff', defaultKey: 'defaultTextColor' },
  backgroundOpacity: { label: '背景不透明度', type: 'number', input: 'range', min: 0, max: 100, default: 100, capability: 'background', unit: '%' },
  scrollDirection: { label: '滚动方向', type: 'select', default: 'up', capability: 'scrollDirection', choices: [['up', '从下向上（新弹幕在底部）'], ['down', '从上向下（新弹幕在顶部）']] },
  edgeFade: { label: '边缘处理', type: 'select', default: 'single', defaultKey: 'defaultEdgeFade', capability: 'scrollDirection', legacy: ['single'],
    help: '可选择上下两端、仅上边或仅下边渐隐；选定的边缘不随滚动方向改变。',
    choices: [['both', '两端渐隐'], ['top', '上边渐隐'], ['bottom', '下边渐隐'], ['none', '直接切断']] },
  entranceAnimation: { label: '入场动画', type: 'select', default: 'fade', capability: 'entranceAnimation', group: 'randomMotion',
    choices: [['fade', '样式渐显'], ['rise', '上浮弹入'], ['none', '直接显示']], help: '只影响新消息；保留本款渐显设计，或选用共用的上浮弹入。' },
  entranceDurationMs: { label: '入场时长', type: 'number', input: 'range', min: 100, max: 1000, default: 200, defaultKey: 'defaultEntranceMs', unit: 'ms', capability: 'entranceAnimation', group: 'randomMotion',
    disabledWhen: ['entranceAnimation', 'none'] },
  durationSeconds: { label: '停留（秒）', type: 'number', min: 2, max: 30, default: 6, layout: 'fullscreen-random', control: 'fullscreenDurationSeconds', group: 'randomMotion',
    help: '包含入场与退场；长留言建议预留更久。调整后用于新消息，已显示弹幕保持原到期时间。' },
  exitAnimation: { label: '退场方式', type: 'select', default: 'fade', layout: 'fullscreen-random', group: 'randomMotion',
    choices: [['fade', '渐隐'], ['none', '直接消失']], help: '控制正常到期时的消失方式。拥挤淘汰、撤回和清空直接移除。' },
  exitDurationMs: { label: '退场时长', type: 'number', input: 'range', min: 100, max: 1000, default: 400, unit: 'ms', layout: 'fullscreen-random', group: 'randomMotion',
    disabledWhen: ['exitAnimation', 'none'], help: '占用停留时间的最后一段，只影响新消息。' },
  speedPixelsPerSecond: { label: '飘动速度', type: 'number', input: 'range', min: 20, max: 600, default: 120, capability: 'speed', control: 'floatingSpeed', group: 'floatingMotion',
    help: '1～100，默认 50 为原速；1 为原速的三分之一，100 为原速的三倍。长句或较窄的组件可适当降低速度。超出刻度范围的旧速度会保留，手动调节后按新刻度保存。' },
  floatingDispersion: { label: '分散程度', type: 'number', input: 'range', min: 1, max: 100, default: 50, layout: 'floating', group: 'floatingMotion',
    help: '数值越大，新弹幕越倾向于远离画面中的其他弹幕。拥挤时以可用空间为准，已显示弹幕不换位置。' },
  floatingEdgeFade: { label: '边缘显隐', type: 'select', default: 'none', defaultKey: 'defaultFloatingEdgeFade', layout: 'floating', group: 'floatingMotion',
    choices: [['both', '两端渐隐'], ['right', '入场端渐显'], ['left', '离场端渐隐'], ['none', '直接切断']],
    help: '入场端为右侧，离场端为左侧。随横移经过边缘时逐渐显隐，完整弹幕和光尾移出后才清理。' },
  floatingEdgeFadeSize: { label: '边缘柔化宽度', type: 'number', input: 'range', min: 4, max: 80, default: 28, unit: 'px', layout: 'floating', group: 'floatingMotion',
    disabledWhen: ['floatingEdgeFade', 'none'], help: '按组件逻辑像素设置，每侧最多占区域宽度的 4%，保留中间的完整阅读区域。' },
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
  ambientMotion: { label: '持续动画', type: 'select', default: 'on', capability: 'ambientMotion', choices: [['on', '开启'], ['off', '关闭']],
    help: '控制图案、纸张或头像的循环动作，保留新弹幕入场和正常移动。' },
  auroraPalette: { label: '薄笺配色', type: 'select', default: 'lilac', capability: 'auroraOptions', group: 'aurora',
    choices: [['lilac', '紫藤极光'], ['glacier', '冰川青蓝'], ['rose', '玫瑰晨曦'], ['champagne', '香槟月白']] },
  auroraSheen: { label: '珠光强度', type: 'number', input: 'range', min: 0, max: 100, default: 55, unit: '%', capability: 'auroraOptions', group: 'aurora',
    help: '调整纸面与边缘的珠光，正文颜色和背景不透明度单独设置。' },
  auroraCharm: { label: '吊饰图案', type: 'select', default: 'star', capability: 'auroraOptions', group: 'aurora',
    choices: [['star', '四角星'], ['moon', '月牙'], ['none', '不显示']] },
  auroraSway: { label: '吊饰摆幅', type: 'number', input: 'range', min: 0, max: 12, default: 5, unit: '°', capability: 'auroraOptions', group: 'aurora',
    help: '在吊饰可见且持续动画开启时生效，只摆动吊饰，文字保持稳定；0° 静止。关闭持续动画会同时停止吊饰和流光。' },
  auroraEntrance: { label: '入场方式', type: 'select', default: 'layered', capability: 'auroraOptions', group: 'aurora',
    choices: [['layered', '薄笺分层展开'], ['none', '直接显示']], help: '只控制纸面、昵称与正文的出现，横向移动和边缘显隐使用通用参数。' },
  auroraEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 180, max: 1200, default: 520, unit: 'ms', capability: 'auroraOptions', group: 'aurora',
    disabledWhen: ['auroraEntrance', 'none'], help: '按比例调整本款分层节奏，只影响新消息。' },
  comicWritingMode: { label: '阅读方向', type: 'select', default: 'horizontal', capability: 'comicOptions', group: 'comic',
    choices: [['horizontal', '横排'], ['vertical', '竖排']], help: '普通弹幕可横排或从右向左竖排；礼物和醒目留言保留横排，方便阅读金额与长文。' },
  comicShape: { label: '气泡造型', type: 'select', default: 'mixed', capability: 'comicOptions', group: 'comic',
    choices: [['mixed', '混排'], ['speech', '对白框'], ['box', '旁白框'], ['burst', '爆炸框']],
    help: '控制后续普通弹幕的外形。礼物使用旁白框，醒目留言使用强调框；混排时同一条消息保持同一造型。' },
  comicStrokeWidth: { label: '墨线粗细', type: 'number', input: 'range', min: 1, max: 4, default: 2, unit: 'px', capability: 'comicOptions', group: 'comic' },
  comicTexture: { label: '网点浓度', type: 'number', input: 'range', min: 0, max: 30, default: 8, unit: '%', capability: 'comicOptions', group: 'comic',
    help: '只调整纸面的印刷网点，0 为关闭，文字和表情保持清晰。' },
  comicEntrance: { label: '入场方式', type: 'select', default: 'pop', capability: 'comicOptions', group: 'comic',
    choices: [['pop', '漫画弹出'], ['ink', '墨线勾勒'], ['fade', '轻柔渐显'], ['none', '直接显示']], help: '只控制新弹幕出现；消失方式在随机弹幕通用参数中调整，已显示弹幕不重播。' },
  comicEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 180, max: 800, default: 420, unit: 'ms', capability: 'comicOptions', group: 'comic',
    disabledWhen: ['comicEntrance', 'none'],
    help: '默认 420ms；越大出现越慢。停留时间包含入场，长留言可适当延长停留。' },
  centerBias: { label: '中心倾向', type: 'number', input: 'range', min: 1, max: 50, default: 1, layout: 'fullscreen-random', group: 'randomMotion' },
  dispersion: { label: '离散程度', type: 'number', input: 'range', min: 1, max: 50, default: 1, layout: 'fullscreen-random', group: 'randomMotion' },
  startrailColor: { label: '星芒颜色', type: 'color', alpha: true, default: '#b9dfff', capability: 'startrailOptions', group: 'startrail',
    help: '同时调整星芒、光尾和星尘的颜色与不透明度，不影响正文。' },
  startrailStarSize: { label: '星芒大小', type: 'number', input: 'range', min: 12, max: 40, default: 24, unit: 'px', capability: 'startrailOptions', group: 'startrail' },
  startrailTailLength: { label: '光尾长度', type: 'number', input: 'range', min: 0, max: 360, default: 180, unit: 'px', capability: 'startrailOptions', group: 'startrail',
    help: '0 隐藏光尾；尾迹完整离开画面后才清理消息。' },
  startrailGlow: { label: '辉光强度', type: 'number', input: 'range', min: 0, max: 100, default: 45, unit: '%', capability: 'startrailOptions', group: 'startrail',
    help: '只调整星芒和光尾，正文保持清晰稳定。' },
  startrailDust: { label: '星尘', type: 'select', default: 'on', choices: [['on', '开启'], ['off', '关闭']], capability: 'startrailOptions', group: 'startrail',
    help: '星尘沿光尾显示；光尾长度为 0 时一并隐藏。' },
  startrailEntrance: { label: '入场方式', type: 'select', default: 'spark', choices: [['spark', '星芒点亮'], ['none', '直接显示']], capability: 'startrailOptions', group: 'startrail',
    help: '只控制星芒、文字与光尾的出现，横向移动和边缘显隐使用通用参数。' },
  startrailEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 250, max: 1200, default: 680, unit: 'ms', capability: 'startrailOptions', group: 'startrail',
    disabledWhen: ['startrailEntrance', 'none'],
    help: '星芒先亮起，昵称和正文随后渐显；建议 450～800ms。只影响新消息，不改变横向速度；离开时随移动自然淡出。' },
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
  if (resolved.entranceAnimation === 'rise' && !Object.hasOwn(options[style] || {}, 'entranceDurationMs')) {
    resolved.entranceDurationMs = 500;
  }
  return resolved;
}

export { DANMAKU_OPTION_FIELDS, REAL_GIFT_STYLES, styleOptionFields, DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, RIPPLOID_COLOR_DEFAULTS, SPOOKY_THEME_COLORS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, TWITTER_COMPOSER_TEXT_DEFAULT, TWITTER_COMPOSER_TEXT_MAX_LENGTH, TWITTER_LAYOUT_DEFAULTS, TWITTER_COLOR_DEFAULTS, inspectComposerText, normalizeStyleOptions, styleOptionsFor };

export function isRandomDanmakuStyle(style) {
  return DANMAKU_STYLE_OPTIONS[style]?.layout === 'fullscreen-random';
}

export function isFloatingDanmakuStyle(style) {
  return DANMAKU_STYLE_OPTIONS[style]?.layout === 'floating';
}

export function applyStyleOptions(document, style, allOptions, legacyDurationSeconds) {
  const options = styleOptionsFor(style, allOptions, legacyDurationSeconds);
  const composer = style === 'twitter' ? document.getElementById?.('twitterComposerText') : null;
  if (composer) composer.textContent = options.composerText;
  document.body.dataset.scrollDirection = options.scrollDirection;
  document.body.dataset.edgeFade = options.edgeFade || 'none';
  document.body.dataset.entranceAnimation = options.entranceAnimation || 'fade';
  document.body.dataset.entranceDurationMs = String(options.entranceDurationMs || 200);
  document.body.dataset.floatingEdgeFade = options.floatingEdgeFade || 'none';
  document.body.dataset.auroraEntrance = options.auroraEntrance || 'layered';
  document.body.dataset.startrailEntrance = options.startrailEntrance || 'spark';
  document.body.dataset.decorationShape = options.decorationShape || 'sparkle';
  document.body.dataset.ambientMotion = options.ambientMotion || 'on';
  document.body.dataset.startrailDust = options.startrailDust || 'on';
  document.body.dataset.auroraPalette = options.auroraPalette || 'lilac';
  document.body.dataset.auroraCharm = options.auroraCharm || 'star';
  document.body.dataset.spookyTheme = options.spookyTheme || 'default';
  document.body.dataset.spookyFrame = options.spookyFrame || 'show';
  document.body.dataset.comicWritingMode = options.comicWritingMode || 'horizontal';
  document.body.dataset.comicShape = options.comicShape || 'mixed';
  document.body.dataset.comicEntrance = options.comicEntrance || 'pop';
  document.body.dataset.comicEntranceMs = String(options.comicEntranceMs || 420);
  const root = document.documentElement.style;
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

export function parseStyleOptions(value) {
  try {
    return normalizeStyleOptions(JSON.parse(value || '{}'));
  } catch {
    return {};
  }
}
