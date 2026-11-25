// Edit this contract; sync-danmaku-style-options.cjs generates the local Node mirror.
import { DANMAKU_TEXT_GROUPS, DANMAKU_TEXT_TARGETS, danmakuTextFields, danmakuTextSizeFields } from './danmaku-text-options.js';
import { DANMAKU_TEXT_APPEARANCE, danmakuTextAppearanceFields } from './danmaku-text-appearance.js';
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
  coffee: {
    scrollDirection: true, label: '咖啡手记',
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 26,
    background: false, giftImage: false, ambientMotion: true,
    defaultTextColor: '#eeeadd',
  },
  astral: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '星芒笺',
    minFontSize: 12, maxFontSize: 48, defaultFontSize: 22,
    background: true, giftImage: false, ambientMotion: true, astralOptions: true,
    defaultTextColor: '#ffffff',
  },
  'charm-thread': {
    label: '垂丝挂链', scrollDirection: true, defaultEdgeFade: 'none',
    minFontSize: 16, maxFontSize: 40, defaultFontSize: 24,
    background: true, defaultBackgroundOpacity: 90, bubbleColor: true, defaultBubbleColor: '#29263e',
    giftImage: false, threadOptions: true, defaultTextColor: '#fbf7ff',
  },
  'celestial-horizontal': {
    layout: 'horizontal', label: '天穹横栏',
    minFontSize: 12, maxFontSize: 40, defaultFontSize: 26,
    background: true, giftImage: false, bubbleColor: true, ambientMotion: true, celestialOptions: true,
    defaultBubbleColor: '#ffd700', defaultTextColor: '#f0f8ff',
  },
  'horizontal-charm': {
    layout: 'horizontal', label: '轻语横栏',
    minFontSize: 12, maxFontSize: 36, defaultFontSize: 24,
    background: true, giftImage: false, bubbleColor: true, charmOptions: true,
    defaultTextColor: '#51465f',
  },
  'neon-glass': {
    scrollDirection: true, label: '晶透胶囊',
    minFontSize: 16, maxFontSize: 40, defaultFontSize: 24,
    background: true, giftImage: false, bubbleColor: true, neonGlassOptions: true,
    defaultTextColor: '#ffffff',
  },
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
    label: '夜航讯号',
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
    label: '经典气泡',
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
    label: '融影名片',
    minFontSize: 18,
    maxFontSize: 42,
    background: true,
    giftImage: true,
    defaultTextColor: '#ffffff',
  },
  sketch: {
    scrollDirection: true,
    label: '森间手绘',
    minFontSize: 18,
    maxFontSize: 48,
    defaultFontSize: 32,
    background: true,
    giftImage: false,
    defaultTextColor: '#7f9f76',
  },
  harbor: {
    scrollDirection: true,
    label: '对白',
    minFontSize: 18,
    maxFontSize: 48,
    defaultFontSize: 31,
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
    defaultFontSize: 30,
    background: false,
    giftImage: false,
    defaultTextColor: '#292b32',
  },
  snowfox: {
    scrollDirection: true,
    label: '雪狐童话',
    minFontSize: 18,
    maxFontSize: 48,
    defaultFontSize: 31,
    background: false,
    giftImage: false,
    bubbleColor: true,
    defaultTextColor: '#78a9d6',
  },
  ripploid: {
    scrollDirection: true,
    label: '先锋票根',
    minFontSize: 18,
    maxFontSize: 48,
    defaultFontSize: 28,
    background: false,
    giftImage: false,
    bubbleColor: true,
    ripploidColors: true,
    defaultBubbleColor: '#eb945e',
    defaultTextColor: '#f5f5f5',
  },
  christmas: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '圣诞华灯',
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 28,
    background: true, giftImage: false, bubbleColor: true, ambientMotion: true, christmasOptions: true,
    defaultBubbleColor: '#782632', defaultTextColor: '#fff1d8',
  },
  stargazer: {
    scrollDirection: true, defaultEdgeFade: 'both', label: '星河漫旅',
    minFontSize: 16, maxFontSize: 36, defaultFontSize: 28,
    background: true, giftImage: false, ambientMotion: true, stargazerOptions: true,
    defaultTextColor: '#f7edff',
  },
  wireframe: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '银环线框',
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 26,
    background: true, giftImage: false, wireframeOptions: true, defaultTextColor: '#ffffff',
  },
  'christmas-letter': {
    scrollDirection: true, defaultEdgeFade: 'none', label: '圣诞来信',
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 28,
    background: true, giftImage: false, defaultTextColor: '#725244',
  },
  'pastel-scrapbook': {
    scrollDirection: true, defaultEdgeFade: 'none', label: '拼贴手账',
    minFontSize: 16, maxFontSize: 48, defaultFontSize: 27,
    background: true, giftImage: false, defaultTextColor: '#f3b1cb',
  },
  notebook: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '折角便签',
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 29,
    background: false, giftImage: false, ambientMotion: true, defaultTextColor: '#3e3e3d',
  },
  glowy: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '暗夜霓光',
    minFontSize: 16, maxFontSize: 40, defaultFontSize: 25,
    background: true, giftImage: false, bubbleColor: true, ambientMotion: true, glowyOptions: true,
    defaultBubbleColor: '#a58aff', defaultTextColor: '#f5f5fa',
  },
  glass: {
    scrollDirection: true, defaultScrollDirection: 'down', defaultEdgeFade: 'none', label: '磨砂通知',
    minFontSize: 16, maxFontSize: 40, defaultFontSize: 33,
    background: true, defaultBackgroundOpacity: 20, giftImage: false, bubbleColor: true, ambientMotion: true, glassOptions: true,
    defaultBubbleColor: '#70c2fe', defaultTextColor: '#ffffff',
  },
  'animated-gradient': {
    scrollDirection: true, defaultEdgeFade: 'none', label: '虹边气泡',
    minFontSize: 16, maxFontSize: 40, defaultFontSize: 25,
    background: true, giftImage: false, ambientMotion: true, gradientOptions: true,
    defaultTextColor: '#242424',
  },
  spooky: {
    scrollDirection: true, defaultEdgeFade: 'none', label: '万圣幽灵',
    minFontSize: 16, maxFontSize: 36, defaultFontSize: 25,
    background: false, giftImage: false, spookyOptions: true,
    defaultTextColor: '#fce6fa',
  },
  twitter: {
    scrollDirection: true,
    composerText: true,
    twitterOptions: true,
    defaultEdgeFade: 'none',
    label: '推文动态',
    minFontSize: 18,
    maxFontSize: 40,
    defaultFontSize: 27,
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
    defaultFontSize: 31,
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
  'dark-moon': {
    scrollDirection: true, defaultEdgeFade: 'none', label: '暗月',
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 32,
    background: true, giftImage: false, ambientMotion: true, darkMoonOptions: true,
    defaultTextColor: '#c9c0dc',
  },
  moonlit: {
    scrollDirection: true,
    label: '月渡花汀',
    minFontSize: 18,
    maxFontSize: 42,
    defaultFontSize: 34,
    background: true,
    giftImage: true,
    defaultTextColor: '#fffaf2',
  },
  'sea-breeze': {
    scrollDirection: true, defaultEdgeFade: 'none', label: '海风倒影',
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 32,
    background: false, giftImage: false, seaBreezeAlignment: true, seaBreezeOptions: true, defaultTextColor: '#ffffff',
  },
  'sea-breeze-random': {
    layout: 'fullscreen-random', label: '海风散影', fullscreenSuperchat: true,
    entranceAnimation: true, defaultEntranceMs: 800,
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 32,
    background: false, giftImage: false, seaBreezeOptions: true, defaultTextColor: '#ffffff',
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
    layout: 'fullscreen-random', label: '漫画分镜', fullscreenSuperchat: true,
    minFontSize: 18, maxFontSize: 42, defaultFontSize: 26, defaultFontFamily: 'serif',
    background: true, giftImage: false, comicOptions: true, defaultTextColor: '#292626',
  },
  window: {
    layout: 'fullscreen-random', label: '散落小窗', fullscreenSuperchat: true,
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 26,
    background: true, giftImage: false, ambientMotion: true, windowOptions: true, defaultTextColor: '#344650',
  },
  stardust: {
    layout: 'fullscreen-random', label: '落星尘', fullscreenSuperchat: true,
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 28, defaultFontFamily: 'serif',
    defaultDurationSeconds: 12, defaultExitMs: 1000,
    background: false, giftImage: false, ambientMotion: true, stardustOptions: true, defaultTextColor: '#f2f5f7',
  },
  'glass-bubble': {
    layout: 'fullscreen-random', label: '玻璃气泡', fullscreenSuperchat: true,
    minFontSize: 18, maxFontSize: 48, defaultFontSize: 27,
    defaultDurationSeconds: 5, eventDurationExtraMs: 3000,
    background: true, giftImage: false, glassBubbleOptions: true, defaultTextColor: '#ffffff',
  },
  mist: {
    layout: 'fullscreen-random',
    fullscreenSuperchat: true,
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
    label: '掠影',
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
  sinking: {
    layout: 'floating', label: '沉笺', fullscreenSuperchat: true,
    minFontSize: 18, maxFontSize: 40, defaultFontSize: 30, defaultFontFamily: 'serif',
    background: true, giftImage: false, sinkingOptions: true, defaultTextColor: '#274b4b',
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
  ...danmakuTextFields(),
  ...Object.fromEntries(Object.keys(DANMAKU_TEXT_APPEARANCE).flatMap(style =>
    Object.entries(danmakuTextAppearanceFields(style)).filter(([, field]) => field.appearanceParent))),
  neonGlassNameColors: { label: '昵称配色', type: 'select', default: 'original', capability: 'neonGlassOptions', group: 'neonGlass',
    choices: [['original', '按昵称配色'], ['identity', '按房间身份'], ['text', '跟随正文']] },
  neonGlassHighlight: { label: '玻璃高光', type: 'number', input: 'range', min: 0, max: 100, default: 100, unit: '%', capability: 'neonGlassOptions', group: 'neonGlass' },
  neonGlassIcons: { label: '提醒图标', type: 'select', default: 'show', capability: 'neonGlassOptions', group: 'neonGlass', choices: [['show', '显示'], ['hide', '隐藏']] },
  neonGlassEntrance: { label: '入场方式', type: 'select', default: 'layered', capability: 'neonGlassOptions', group: 'neonGlass', choices: [['layered', '玻璃与文字分层渐显'], ['none', '直接显示']] },
  neonGlassEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 200, max: 1000, default: 480, unit: 'ms', capability: 'neonGlassOptions', group: 'neonGlass', disabledWhen: ['neonGlassEntrance', 'none'] },
  fontFamily: { label: '字体', type: 'font', default: 'default', defaultKey: 'defaultFontFamily' },
  fontSize: { label: '正文字号', type: 'number', default: 30, defaultKey: 'defaultFontSize', minKey: 'minFontSize', maxKey: 'maxFontSize', help: '控制弹幕正文和行内表情大小（昵称、粉丝牌、金额等可在上方表格里单独调）。建议让 OBS 或直播姬的浏览器源宽高与画布保持一致，方便对照预览中的字号。' },
  textColor: { label: '正文颜色', type: 'color', alpha: true, default: '#eaf2ff', defaultKey: 'defaultTextColor' },
  backgroundOpacity: { label: '背景不透明度', type: 'number', input: 'range', min: 0, max: 100, default: 100, defaultKey: 'defaultBackgroundOpacity', capability: 'background', unit: '%' },
  christmasBackground: { label: '卡片背景', type: 'select', default: 'card', capability: 'christmasOptions',
    choices: [['card', '正常卡片'], ['transparent', '仅文字与挂饰']], help: '选「仅文字与挂饰」时会隐去卡片底色和金框，只留文字、蝴蝶结和挂饰。' },
  scrollDirection: { label: '滚动方向', type: 'select', default: 'up', defaultKey: 'defaultScrollDirection', capability: 'scrollDirection', choices: [['up', '从下向上（新弹幕在底部）'], ['down', '从上向下（新弹幕在顶部）']] },
  edgeFade: { label: '边缘处理', type: 'select', default: 'single', defaultKey: 'defaultEdgeFade', capability: 'scrollDirection', legacy: ['single'],
    help: '设置弹幕滚到画面顶部或底部时的淡出效果（固定的上/下位置不会随滚动方向反转）。',
    choices: [['both', '两端渐隐'], ['top', '上边渐隐'], ['bottom', '下边渐隐'], ['none', '直接切断']] },
  entranceAnimation: { label: '入场动画', type: 'select', default: 'fade', capability: 'entranceAnimation', group: 'randomMotion',
    choices: [['fade', '样式渐显'], ['rise', '上浮弹入'], ['none', '直接显示']], help: '只对新发出的弹幕生效。' },
  entranceDurationMs: { label: '入场时长', type: 'number', input: 'range', min: 100, max: 1000, default: 200, defaultKey: 'defaultEntranceMs', unit: 'ms', capability: 'entranceAnimation', group: 'randomMotion',
    disabledWhen: ['entranceAnimation', 'none'] },
  durationSeconds: { label: '停留（秒）', type: 'number', min: 2, max: 30, default: 6, defaultKey: 'defaultDurationSeconds', layout: 'fullscreen-random', control: 'fullscreenDurationSeconds', group: 'randomMotion',
    help: '每条弹幕从出现到消失的总时长（仅对新弹幕生效）。' },
  exitAnimation: { label: '退场方式', type: 'select', default: 'fade', layout: 'fullscreen-random', group: 'randomMotion',
    choices: [['fade', '渐隐'], ['none', '直接消失']], help: '控制正常到期时的消失方式。拥挤淘汰、撤回和清空直接移除。' },
  exitDurationMs: { label: '退场时长', type: 'number', input: 'range', min: 100, max: 1000, default: 400, defaultKey: 'defaultExitMs', unit: 'ms', layout: 'fullscreen-random', group: 'randomMotion',
    disabledWhen: ['exitAnimation', 'none'], help: '占用停留时间的最后一段，只影响新消息。' },
  speedPixelsPerSecond: { label: '飘动速度', type: 'number', input: 'range', min: 20, max: 600, default: 120, capability: 'speed', control: 'floatingSpeed', group: 'floatingMotion',
    help: '1–100 可调，默认 50 为标准速度（1 最慢，100 最快）。如果画面较窄或长句较多，可以适当调慢一点。' },
  floatingDispersion: { label: '分散程度', type: 'number', input: 'range', min: 1, max: 100, default: 50, capability: 'speed', group: 'floatingMotion',
    help: '数值越大，新飘出来的弹幕越会主动避开已有的弹幕，减少重叠。' },
  floatingEdgeFade: { label: '边缘显隐', type: 'select', default: 'none', defaultKey: 'defaultFloatingEdgeFade', capability: 'speed', group: 'floatingMotion',
    choices: [['both', '两端渐隐'], ['right', '入场端渐显'], ['left', '离场端渐隐'], ['none', '直接切断']],
    help: '弹幕从右侧飘入、左侧飘出时，在画面边缘柔和渐显/渐隐，不会生硬切断。' },
  floatingEdgeFadeSize: { label: '边缘柔化宽度', type: 'number', input: 'range', min: 4, max: 80, default: 28, unit: 'px', capability: 'speed', group: 'floatingMotion',
    disabledWhen: ['floatingEdgeFade', 'none'], help: '控制左右边缘渐隐过渡带的宽窄（每侧最宽不超过画面宽度的 4%，确保中间文字清晰）。' },
  bubbleColor: { label: '弹幕配色', type: 'color', alpha: true, allowDefault: true, default: 'default', capability: 'bubbleColor' },
  giftImage: { label: '礼物图片', type: 'select', default: 'theme', capability: 'giftImage', choices: [['theme', '样式插画'], ['gift', '真实礼物图片']], group: 'message' },
  seaBreezeAlign: { label: '文字对齐', type: 'select', default: 'center', capability: 'seaBreezeAlignment',
    choices: [['left', '居左'], ['center', '居中'], ['right', '居右']] },
  minGiftAmount: { label: '弹幕礼物卡片最低金额', type: 'number', min: 0, max: 100000, step: 0.01, default: 0, capability: 'minGiftAmount', group: 'message',
    help: '只显示单次送礼总金额达到该数值的礼物和上舰卡片（填 0 显示全部；醒目留言 SC 不受此限制）。' },
  composerText: { label: '底部提示文字', type: 'text', default: TWITTER_COMPOSER_TEXT_DEFAULT, capability: 'composerText', maxLength: TWITTER_COMPOSER_TEXT_MAX_LENGTH },
  ...Object.fromEntries(Object.entries(TWITTER_LAYOUT_DEFAULTS).map(([key, value], index) => [key, {
    label: ['顶部资料区', '底部提示栏', '操作图标行'][index], type: 'select', default: value, capability: 'twitterOptions', choices: [['show', '显示'], ['hide', '隐藏']],
  }])),
  ...Object.fromEntries(Object.entries(TWITTER_COLOR_DEFAULTS).map(([key, value], index) => [key, {
    label: ['＜50 元', '50～99.99 元', '100～999.99 元', '≥1000 元'][index], type: 'color', alpha: true, default: value, capability: 'twitterOptions', group: 'twitterColors',
  }])),
  spookyTheme: { label: '主题配色', type: 'select', default: 'default', capability: 'spookyOptions', choices: [['default', 'Default · 紫色'], ['autumn', 'Autumn · 秋日'], ['graveyard', 'Graveyard · 灰紫'], ['moonlight', 'Moonlight · 月光']] },
  spookyFrame: { label: '消息区外框', type: 'select', default: 'show', capability: 'spookyOptions', choices: [['show', '显示'], ['hide', '隐藏']] },
  ...Object.fromEntries(SPOOKY_COLOR_KEYS.filter(key => key !== 'textColor').map((key, index) => [key, {
    label: ['外框底色', '消息底色', '事件卡底色', '装饰强调色'][index], type: 'color', alpha: true, allowDefault: true, default: 'default', capability: 'spookyOptions', group: 'spookyColors',
  }])),
  ...Object.fromEntries(SPOOKY_OPACITY_KEYS.map((key, index) => [key, {
    label: ['外框不透明度', '消息不透明度', '事件不透明度'][index], type: 'number', input: 'range', min: 0, max: 100, default: 100, unit: '%', capability: 'spookyOptions', group: 'spookyColors',
  }])),
  ...Object.fromEntries(Object.entries(RIPPLOID_COLOR_DEFAULTS).map(([key, value], index) => [key, {
    label: key.startsWith('guard') ? ['舰长', '提督', '总督'][index - 6]
      : ['＜50 元', '50 至不足 100 元', '100 至不足 500 元', '500 至不足 1000 元', '1000 至不足 2000 元', '≥2000 元'][index < 6 ? index : index - 9],
    type: 'color', default: value, capability: 'ripploidColors',
    group: key.startsWith('gift') ? 'ripploidGift' : key.startsWith('guard') ? 'ripploidGuard' : 'ripploidSuperchat',
  }])),
  decorationShape: { label: '装饰图案', type: 'select', default: 'sparkle', capability: 'decorationShape', help: '每种图案搭配自己的轻动画，切换图案即可预览。',
    choices: [['sparkle', '四角星'], ['heart', '爱心'], ['square', '圆角方块'], ['star', '五角星'], ['flower', '小花'], ['moon', '月牙'], ['bow', '蝴蝶结']] },
  ambientMotion: { label: '持续动画', type: 'select', default: 'on', capability: 'ambientMotion', choices: [['on', '开启'], ['off', '关闭']],
    help: '控制装饰图案、卡片或头像的轻微呼吸/摆动动效；关闭后不影响弹幕正常进出场。' },
  astralAccentColor: { label: '星芒颜色', type: 'color', alpha: true, default: '#f7e68b', capability: 'astralOptions', group: 'astral' },
  astralEntrance: { label: '入场方式', type: 'select', default: 'layered', capability: 'astralOptions', group: 'astral',
    choices: [['layered', '描框与星芒点亮'], ['none', '直接显示']] },
  threadAlign: { label: '弹幕对齐', type: 'select', default: 'left', capability: 'threadOptions', group: 'threadBasic',
    choices: [['left', '左对齐'], ['right', '右对齐']], help: '昵称和气泡贴齐同一侧，细链挂在这一侧的外缘。' },
  threadCharm: { label: '挂件图案', type: 'select', default: 'role', capability: 'threadOptions', group: 'threadBasic',
    choices: [['role', '跟随房间身份'], ['butterfly', '蝶扣'], ['moon', '月牙'], ['lotus', '莲花'], ['star', '四芒星']] },
  threadEntrance: { label: '挂链入场', type: 'select', default: 'layered', capability: 'threadOptions', group: 'threadAdvanced',
    choices: [['layered', '牵线、落扣、流光'], ['none', '直接显示']] },
  threadEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 300, max: 1200, default: 800, unit: 'ms',
    capability: 'threadOptions', group: 'threadAdvanced', disabledWhen: ['threadEntrance', 'none'] },
  gradientPalette: { label: '渐变配色', type: 'select', default: 'original', capability: 'gradientOptions', group: 'gradient',
    choices: [['original', '原作流彩'], ['sunset', '落日暖霞'], ['ocean', '海盐青蓝'], ['lavender', '薰衣草紫']], help: '联动昵称牌、事件标签和气泡彩边，正文颜色单独保留。' },
  gradientCycleSeconds: { label: '流转周期', type: 'number', input: 'range', min: 6, max: 24, default: 10, unit: '秒', capability: 'gradientOptions', group: 'gradient',
    disabledWhen: ['ambientMotion', 'off'], help: '数值越大，颜色变化越慢；不改变消息保留时间。' },
  gradientUnderline: { label: '下划线', type: 'select', default: 'show', capability: 'gradientOptions', group: 'gradient', choices: [['show', '显示'], ['hide', '隐藏']] },
  glassBubbleReveal: { label: '显字方式', type: 'select', default: 'typing', capability: 'glassBubbleOptions', group: 'glassBubble',
    choices: [['typing', '逐字显现'], ['instant', '整句显示']], help: '「逐字显现」有打字机效果；「整句显示」则随气泡展开直接显出全文（仅对新弹幕生效）。' },
  glassBubbleTypingSpeed: { label: '显字间隔', type: 'number', input: 'range', min: 10, max: 60, default: 26, unit: 'ms', capability: 'glassBubbleOptions', group: 'glassBubble',
    disabledWhen: ['glassBubbleReveal', 'instant'], help: '数值越小打字越快；遇到长弹幕会自动加速，确保在消失前能把字打完。' },
  glassBubbleSweep: { label: 'SC 扫光', type: 'select', default: 'on', capability: 'glassBubbleOptions', group: 'glassBubble', choices: [['on', '开启'], ['off', '关闭']] },
  glassBubbleHighlight: { label: '玻璃高光', type: 'number', input: 'range', min: 0, max: 100, default: 100, unit: '%', capability: 'glassBubbleOptions', group: 'glassBubble',
    help: '调整银边和表面高光，正文与金额保持清晰。' },
  celestialNebulaOpacity: { label: '星云浓度', type: 'number', input: 'range', min: 0, max: 100, default: 30, unit: '%', capability: 'celestialOptions', group: 'celestial' },
  charmGap: { label: '消息间距', type: 'number', input: 'range', min: 8, max: 80, default: 32, unit: 'px', capability: 'charmOptions', group: 'charm' },
  charmMaxWidth: { label: '气泡最大宽度', type: 'number', input: 'range', min: 240, max: 1000, default: 560, unit: 'px', capability: 'charmOptions', group: 'charm',
    help: '长消息自动换行，保留完整文字；可在画布中增加横栏高度。' },
  celestialStarDensity: { label: '星点疏密', type: 'select', default: 'normal', capability: 'celestialOptions', group: 'celestial',
    choices: [['off', '关闭'], ['sparse', '稀疏'], ['normal', '原作'], ['dense', '繁星']] },
  celestialStarShape: { label: '星标造型', type: 'select', default: 'identity', capability: 'celestialOptions', group: 'celestial',
    choices: [['identity', '按昵称变化'], ['sparkle', '四角星'], ['star', '五角星']] },
  celestialSeparator: { label: '消息分隔线', type: 'select', default: 'show', capability: 'celestialOptions', group: 'celestial', choices: [['show', '显示'], ['hide', '隐藏']] },
  glowyLayout: { label: '消息排列', type: 'select', default: 'vertical', capability: 'glowyOptions', group: 'glowy',
    choices: [['vertical', '竖排'], ['horizontal', '横排']], help: '选「横排」时记得在画布里把组件框拉宽；此时若滚动方向选「从下向上」，新弹幕会从右边进，反之从左边进。' },
  glowyAvatar: { label: '观众头像', type: 'select', default: 'show', capability: 'glowyOptions', group: 'glowy', choices: [['show', '显示'], ['hide', '隐藏']] },
  glowyTime: { label: '消息时间', type: 'select', default: 'show', capability: 'glowyOptions', group: 'glowy', choices: [['show', '显示'], ['hide', '隐藏']] },
  glowyLight: { label: '侧光强度', type: 'number', input: 'range', min: 0, max: 100, default: 85, unit: '%', capability: 'glowyOptions', group: 'glowy' },
  glassTime: { label: '消息时间', type: 'select', default: 'show', capability: 'glassOptions', group: 'glass', choices: [['show', '显示'], ['hide', '隐藏']] },
  glassGlintIntensity: { label: '星点闪光强度', type: 'number', input: 'range', min: 0, max: 100, default: 100, unit: '%', capability: 'glassOptions', group: 'glass',
    disabledWhen: ['ambientMotion', 'off'] },
  glassDensity: { label: '卡片密度', type: 'select', default: 'comfortable', capability: 'glassOptions', group: 'glass', choices: [['comfortable', '舒展'], ['compact', '紧凑']] },
  darkMoonPalette: { label: '月光配色', type: 'select', default: 'original', capability: 'darkMoonOptions', group: 'darkMoon',
    choices: [['original', '原作紫金'], ['moonlight', '月白银紫'], ['ice', '冰蓝星夜']], help: '调整月环、边线和装饰；自定义正文颜色单独保留。' },
  darkMoonRingSize: { label: '月环大小', type: 'number', input: 'range', min: 70, max: 140, default: 100, unit: '%', capability: 'darkMoonOptions', group: 'darkMoon' },
  darkMoonSparks: { label: '边角星芒', type: 'select', default: 'show', capability: 'darkMoonOptions', group: 'darkMoon', choices: [['show', '显示'], ['hide', '隐藏']] },
  wireframeFadeLength: { label: '框线渐隐长度', type: 'number', input: 'range', min: 0, max: 100, default: 100, unit: '%', capability: 'wireframeOptions', group: 'wireframe',
    help: '调整普通消息框右侧渐隐所占宽度；0 保留完整框线，大航海原有多层线框不受影响。' },
  wireframeOrbit: { label: '头像圈线', type: 'select', default: 'show', capability: 'wireframeOptions', group: 'wireframe', choices: [['show', '显示'], ['hide', '隐藏']] },
  wireframeEntrance: { label: '入场方式', type: 'select', default: 'traced', capability: 'wireframeOptions', group: 'wireframe', choices: [['traced', '圈线与描框'], ['none', '直接显示']] },
  wireframeEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 350, max: 1400, default: 700, unit: 'ms', capability: 'wireframeOptions', group: 'wireframe',
    disabledWhen: ['wireframeEntrance', 'none'], help: '控制线条勾勒入场的快慢（上舰卡片动画会比普通弹幕更舒展一些，仅对新弹幕生效）。' },
  seaBreezeReflectionOpacity: { label: '倒影强度', type: 'number', input: 'range', min: 0, max: 60, default: 28, unit: '%', capability: 'seaBreezeOptions', group: 'seaBreeze',
    help: '0 关闭倒影；不改变正文和身份牌的不透明度。' },
  seaBreezeReflectionLength: { label: '倒影长度', type: 'number', input: 'range', min: 0, max: 200, default: 130, unit: '%', capability: 'seaBreezeOptions', group: 'seaBreeze',
    help: '相对于正文字号的高度，固定款和随机款分别保存。' },
  seaBreezeReflectionGap: { label: '倒影距离', type: 'number', input: 'range', min: -20, max: 30, default: -9, unit: 'px', capability: 'seaBreezeOptions', group: 'seaBreeze',
    help: '负值让倒影靠近正文，正值增加间隔。' },
  stargazerPalette: { label: '星河配色', type: 'select', default: 'mixed', capability: 'stargazerOptions', group: 'stargazer',
    choices: [['mixed', '紫金混排'], ['purple', '紫色'], ['gold', '金色'], ['chat-purple', '紫色消息 · 金色事件'], ['chat-gold', '金色消息 · 紫色事件'], ['custom', '自定义单色']] },
  stargazerColor: { label: '自定义星光色', type: 'color', default: '#c04efe', capability: 'stargazerOptions', group: 'stargazer',
    help: '在自定义单色模式中同步调整边缘、昵称、图标与渐变。' },
  stargazerLayout: { label: '排列方式', type: 'select', default: 'vertical', capability: 'stargazerOptions', group: 'stargazer',
    choices: [['vertical', '纵向消息流'], ['horizontal', '横向消息流']], help: '选「横向消息流」时记得在画布里把组件框拉宽；此时若滚动方向选「从下向上」，新弹幕会从右边进，反之从左边进。' },
  stargazerWidth: { label: '横排消息宽度', type: 'number', input: 'range', min: 220, max: 600, default: 320, unit: 'px', capability: 'stargazerOptions', group: 'stargazer' },
  stargazerGap: { label: '消息间距', type: 'number', input: 'range', min: 6, max: 40, default: 24, unit: 'px', capability: 'stargazerOptions', group: 'stargazer' },
  stargazerAlign: { label: '未铺满时对齐', type: 'select', default: 'bottom', capability: 'stargazerOptions', group: 'stargazer', choices: [['bottom', '靠近新消息入口'], ['top', '靠近旧消息出口']] },
  stargazerFrame: { label: '消息区外框', type: 'select', default: 'hide', capability: 'stargazerOptions', group: 'stargazer', choices: [['hide', '隐藏'], ['show', '显示']] },
  stargazerPerspective: { label: '透视方向', type: 'select', default: 'none', capability: 'stargazerOptions', group: 'stargazer', choices: [['none', '平面'], ['left', '左侧向远处倾斜'], ['right', '右侧向远处倾斜']] },
  stargazerAngle: { label: '透视角度', type: 'number', input: 'range', min: 0, max: 12, default: 6, unit: '°', capability: 'stargazerOptions', group: 'stargazer' },
  stargazerGlow: { label: '霓虹强度', type: 'number', input: 'range', min: 0, max: 20, default: 8, capability: 'stargazerOptions', group: 'stargazer' },
  stargazerGradient: { label: '双边渐变', type: 'select', default: 'on', capability: 'stargazerOptions', group: 'stargazer', choices: [['on', '开启'], ['off', '关闭']] },
  stargazerGradientOpacity: { label: '渐变浓度', type: 'number', input: 'range', min: 0, max: 100, default: 40, unit: '%', capability: 'stargazerOptions', group: 'stargazer' },
  stargazerMaxMessages: { label: '最多消息数', type: 'number', min: 1, max: 50, default: 13, capability: 'stargazerOptions', group: 'stargazer' },
  stargazerHideSeconds: { label: '消息保留秒数', type: 'number', min: 0, max: 999, default: 0, unit: '秒', capability: 'stargazerOptions', group: 'stargazer', help: '填 0 则一直保留到被新弹幕顶出画面；填具体秒数则到时间后自动淡出消失。' },
  auroraPalette: { label: '薄笺配色', type: 'select', default: 'lilac', capability: 'auroraOptions', group: 'aurora',
    choices: [['lilac', '紫藤极光'], ['glacier', '冰川青蓝'], ['rose', '玫瑰晨曦'], ['champagne', '香槟月白']] },
  auroraSheen: { label: '珠光强度', type: 'number', input: 'range', min: 0, max: 100, default: 55, unit: '%', capability: 'auroraOptions', group: 'aurora',
    help: '调整纸面与边缘的珠光，正文颜色和背景不透明度单独设置。' },
  auroraCharm: { label: '吊饰图案', type: 'select', default: 'star', capability: 'auroraOptions', group: 'aurora',
    choices: [['star', '四角星'], ['moon', '月牙'], ['none', '不显示']] },
  auroraSway: { label: '吊饰摆幅', type: 'number', input: 'range', min: 0, max: 12, default: 5, unit: '°', capability: 'auroraOptions', group: 'aurora',
    help: '吊饰左右轻晃的角度（0° 为静止；需显示吊饰且开启「持续动画」时生效）。' },
  auroraEntrance: { label: '入场方式', type: 'select', default: 'layered', capability: 'auroraOptions', group: 'aurora',
    choices: [['layered', '薄笺分层展开'], ['none', '直接显示']], help: '控制卡片出现时的展开动效，不影响横向飘动。' },
  auroraEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 180, max: 1200, default: 520, unit: 'ms', capability: 'auroraOptions', group: 'aurora',
    disabledWhen: ['auroraEntrance', 'none'], help: '控制卡片分层展开的快慢（仅对新弹幕生效）。' },
  comicWritingMode: { label: '阅读方向', type: 'select', default: 'horizontal', capability: 'comicOptions', group: 'comic',
    choices: [['horizontal', '横排'], ['vertical', '竖排']], help: '普通弹幕可横排或从右向左竖排；礼物和醒目留言保留横排，方便阅读金额与长文。' },
  comicShape: { label: '气泡造型', type: 'select', default: 'mixed', capability: 'comicOptions', group: 'comic',
    choices: [['mixed', '混排'], ['speech', '对白框'], ['box', '旁白框'], ['burst', '爆炸框']],
    help: '控制后续普通弹幕的外形。礼物使用旁白框，醒目留言使用强调框；混排时同一条消息保持同一造型。' },
  comicStrokeWidth: { label: '墨线粗细', type: 'number', input: 'range', min: 1, max: 4, default: 2, unit: 'px', capability: 'comicOptions', group: 'comic' },
  comicTexture: { label: '网点浓度', type: 'number', input: 'range', min: 0, max: 30, default: 8, unit: '%', capability: 'comicOptions', group: 'comic',
    help: '只调整纸面的印刷网点，0 为关闭，文字和表情保持清晰。' },
  comicEntrance: { label: '入场方式', type: 'select', default: 'pop', capability: 'comicOptions', group: 'comic',
    choices: [['pop', '漫画弹出'], ['ink', '墨线勾勒'], ['fade', '轻柔渐显'], ['none', '直接显示']], help: '仅控制新弹幕出现时的漫画动效；退场方式在上方「随机弹幕通用参数」里设置。' },
  comicEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 180, max: 800, default: 420, unit: 'ms', capability: 'comicOptions', group: 'comic',
    disabledWhen: ['comicEntrance', 'none'],
    help: '数值越大，弹幕弹出或勾勒得越慢。' },
  windowPalette: { label: '小窗配色', type: 'select', default: 'porcelain', capability: 'windowOptions', group: 'window',
    choices: [['porcelain', '白瓷蓝'], ['sakura', '樱花粉'], ['night', '月夜蓝']],
    help: '同步调整窗面、边框与昵称牌；自定义正文颜色单独保留。' },
  windowWidth: { label: '小窗宽度', type: 'number', input: 'range', min: 220, max: 560, default: 380, unit: 'px', capability: 'windowOptions', group: 'window',
    help: '每张小窗的最大宽度，长弹幕会自动换行；画布区域较窄时会自动等比缩小。' },
  windowRadius: { label: '小窗圆角', type: 'number', input: 'range', min: 10, max: 36, default: 22, unit: 'px', capability: 'windowOptions', group: 'window' },
  windowControls: { label: '窗角图标', type: 'select', default: 'show', capability: 'windowOptions', group: 'window',
    choices: [['show', '显示'], ['hide', '隐藏']], help: '右上角的最小化与关闭图形仅作装饰，不是操作按钮。' },
  windowGuard: { label: '大航海图标', type: 'select', default: 'show', capability: 'windowOptions',
    choices: [['show', '显示'], ['hide', '隐藏']], help: '昵称右侧显示当前直播间的舰长、提督或总督图标；没有身份时隐藏。' },
  windowMedal: { label: '粉丝牌', type: 'select', default: 'show', capability: 'windowOptions',
    choices: [['show', '显示'], ['hide', '隐藏']], help: '大航海图标右侧显示当前直播间的粉丝牌名称和等级，沿用粉丝牌配色；没有粉丝牌时隐藏。' },
  windowEntrance: { label: '入场方式', type: 'select', default: 'mixed', capability: 'windowOptions', group: 'window',
    choices: [['mixed', '随机混合'], ['pop', '轻弹出现'], ['unfold', '小窗展开'], ['rise', '轻盈上浮'], ['none', '直接显示']],
    help: '选「随机混合」时每条新弹幕会随机挑一种动效入场。' },
  windowEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 180, max: 1000, default: 460, unit: 'ms', capability: 'windowOptions', group: 'window',
    disabledWhen: ['windowEntrance', 'none'], help: '控制小窗展开的快慢（包含在总停留时间内）。' },
  centerBias: { label: '中心倾向', type: 'number', input: 'range', min: 1, max: 50, default: 1, layout: 'fullscreen-random', group: 'randomMotion' },
  stardustEntrance: { label: '汇聚与点亮', type: 'select', default: 'on', capability: 'stardustOptions', group: 'stardust',
    choices: [['on', '开启'], ['off', '直接显示']], help: '正文与昵称从上下两侧汇聚，随后点亮星芒；完整入场约 1.4 秒。只影响新消息。' },
  stardustKeepCenter: { label: '为主播留白', type: 'select', default: 'on', capability: 'stardustOptions', group: 'stardust',
    choices: [['on', '开启'], ['off', '关闭']], help: '普通消息散落四周，保留画面中央；区域过窄时按可用空间排布。' },
  stardustNicknames: { label: '观众昵称', type: 'select', default: 'show', capability: 'stardustOptions', group: 'stardust', choices: [['show', '显示'], ['hide', '隐藏']] },
  stardustGiftThreshold: { label: '大额礼物门槛', type: 'number', min: .01, max: 1000000, step: .01, default: .01, unit: '元', capability: 'stardustOptions', group: 'stardust',
    help: '单次送礼总金额达到该数值时，固定在画面顶部醒目位置展示（未达标的散落在四周，上舰默认固定在底部）。' },
  stardustSwapAnchors: { label: '礼物与上舰上下对调', type: 'select', default: 'off', capability: 'stardustOptions', group: 'stardust', choices: [['off', '礼物在上，上舰在下'], ['on', '上舰在上，礼物在下']] },
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
    help: '控制弹幕出现时星芒点亮的动效，不影响横向飘动。' },
  startrailEntranceMs: { label: '入场时长', type: 'number', input: 'range', min: 250, max: 1200, default: 680, unit: 'ms', capability: 'startrailOptions', group: 'startrail',
    disabledWhen: ['startrailEntrance', 'none'],
    help: '星芒亮起并浮现文字的时长（建议 450–800ms，不影响横向飘动速度）。' },
  sinkingPalette: { label: '色泽', type: 'select', default: 'ivory', capability: 'sinkingOptions', group: 'sinking',
    choices: [['ivory', '珍珠白'], ['mint', '浅海绿'], ['blue', '冰蓝']] },
  sinkingDurationSeconds: { label: '停留时间', type: 'number', min: 2, max: 30, default: 10, unit: '秒', capability: 'sinkingOptions', group: 'sinking',
    help: '弹幕从浮现、缓缓下沉到消失的总时长（仅对新弹幕生效）。' },
  sinkingTravel: { label: '下沉行程', type: 'number', input: 'range', min: 10, max: 40, default: 24, unit: '%', capability: 'sinkingOptions', group: 'sinking',
    help: '弹幕在画面中向下漂落的垂直距离占比。' },
  sinkingSway: { label: '水流幅度', type: 'number', input: 'range', min: 0, max: 36, default: 18, unit: 'px', capability: 'sinkingOptions', group: 'sinking',
    help: '下沉时随水流左右轻晃的幅度。' },
  sinkingBubbleDensity: { label: '气泡密度', type: 'number', input: 'range', min: 1, max: 100, default: 50, capability: 'sinkingOptions', group: 'sinking',
    help: '1 为极少，50 适中，100 为密集气泡流；越接近上限，气泡增加越明显。' },
});
const REAL_GIFT_STYLES = Object.freeze(['identity', 'transparent', 'outline', 'bubble', 'cream', 'twitter', 'glass', 'startrail', 'sinking']);
const STYLE_OPTION_FIELDS = Object.fromEntries(Object.entries(DANMAKU_STYLE_OPTIONS).map(([style, limits]) => {
  const textSizes = danmakuTextSizeFields(style);
  const textAppearance = danmakuTextAppearanceFields(style);
  return [style, Object.fromEntries(Object.entries(DANMAKU_OPTION_FIELDS)
    .filter(([key, field]) => (!field.capability || limits[field.capability]) && (!field.layout || limits.layout === field.layout)
      && (!field.textRole || field.textRole === 'body' && textAppearance[key] || DANMAKU_TEXT_TARGETS[style]?.[field.textRole]))
    .filter(([key, field]) => !field.textRole || field.type !== 'number' || textSizes[key])
    .filter(([key, field]) => !field.appearanceParent || textAppearance[key])
    .map(([key, field]) => [key, Object.freeze({ ...field,
      default: limits[field.defaultKey] ?? field.default,
      ...(field.minKey ? { min: limits[field.minKey], max: limits[field.maxKey] } : {}),
      ...textSizes[key],
      ...textAppearance[key],
    })]))];
}));

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
  if (fields.durationSeconds && !DANMAKU_STYLE_OPTIONS[style]?.defaultDurationSeconds && Number.isInteger(legacyDurationSeconds)
    && legacyDurationSeconds >= fields.durationSeconds.min && legacyDurationSeconds <= fields.durationSeconds.max) {
    defaults.durationSeconds = legacyDurationSeconds;
  }
  let resolved = defaults;
  let saved = {};
  try {
    saved = normalizeStyleOptions({ [style]: options[style] || {} })[style];
    resolved = { ...defaults, ...saved };
  } catch {
    resolved = defaults;
  }
  for (const [key, field] of Object.entries(fields)) {
    if (field.legacySizeKey && !Object.hasOwn(saved, key) && Object.hasOwn(saved, field.legacySizeKey)) {
      resolved[key] = saved[field.legacySizeKey];
    }
  }
  if (style === 'spooky' && !Object.hasOwn(options[style] || {}, 'textColor')) {
    resolved.textColor = SPOOKY_THEME_COLORS[resolved.spookyTheme].textColor;
  }
  if (style === 'sinking' && !Object.hasOwn(options[style] || {}, 'textColor')) {
    resolved.textColor = { ivory: '#274b4b', mint: '#1d4b42', blue: '#234b60' }[resolved.sinkingPalette];
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

export { DANMAKU_TEXT_GROUPS, DANMAKU_TEXT_TARGETS, DANMAKU_OPTION_FIELDS, REAL_GIFT_STYLES, styleOptionFields, DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, RIPPLOID_COLOR_DEFAULTS, SPOOKY_THEME_COLORS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, TWITTER_COMPOSER_TEXT_DEFAULT, TWITTER_COMPOSER_TEXT_MAX_LENGTH, TWITTER_LAYOUT_DEFAULTS, TWITTER_COLOR_DEFAULTS, inspectComposerText, normalizeStyleOptions, styleOptionsFor };

export function isRandomDanmakuStyle(style) {
  return DANMAKU_STYLE_OPTIONS[style]?.layout === 'fullscreen-random';
}

export function isFloatingDanmakuStyle(style) {
  return DANMAKU_STYLE_OPTIONS[style]?.layout === 'floating';
}

export function supportsDanmakuSuperchat(style, fullscreen = isRandomDanmakuStyle(style) || isFloatingDanmakuStyle(style)) {
  return !fullscreen || DANMAKU_STYLE_OPTIONS[style]?.fullscreenSuperchat === true;
}

export function parseStyleOptions(value) {
  try {
    return normalizeStyleOptions(JSON.parse(value || '{}'));
  } catch {
    return {};
  }
}
