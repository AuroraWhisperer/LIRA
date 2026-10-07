import { BACKGROUND_FIELDS } from './background-appearance.js';

// Canvas appearance only. Sessions, gift accounting and library edits keep their existing owners.
const text = (label, value = '', maxLength = 80) => ({ label, type: 'text', default: value, maxLength });
const number = (label, value, min, max, step = 1) => ({ label, type: 'number', default: value, min, max, step });
const check = (label, value = true) => ({ label, type: 'checkbox', default: value });
const color = (label, value) => ({ label, type: 'color', default: value });
const select = (label, value, options) => ({ label, type: 'select', default: value, options });
const variant = (value, label, sample = label) => ({ value, label, sample });
const fontWeight = select('字重', '800', { 400: '常规', 500: '中等', 600: '半粗', 700: '加粗', 800: '特粗' });

export const SCENE_EXTRA_COMPONENTS = Object.freeze({
  background: {
    title: '背景', size: [1920, 1080], path: '/background', variantKey: 'style',
    variants: [],
    fields: { style: select('背景样式', 'none', { none: '无背景', moonlit: '月渡花汀 · 静态', 'moonlit-animated': '月渡花汀 · 动态' }), ...BACKGROUND_FIELDS },
  },
  opening: {
    title: '开播动画', size: [1920, 1080], path: '/opening', variantKey: 'style',
    variants: [{ ...variant('classic', '经典舞台'), image: '/img/component-previews/opening-default.webp' },
      variant('pixel-cassette', '像素卡带')],
    fields: { style: select('展示样式', 'original', { original: '跟随客户端', classic: '经典舞台',
      'pixel-cassette': '像素卡带', 'moonlit-fan': '月渡花汀' }) },
  },
  songlist: {
    title: '展示板', size: [480, 800], path: '/songlist',
    variants: [variant('default', '展示板', '可点歌单')],
    fields: {
      songBoardTitle: text('标题', '可点歌单'), category: text('歌曲分类（留空显示全部）'),
      songBoardSortMode: select('歌曲排序', 'initial', { initial: '首字母', category: '歌曲分类', artist: '歌手', language: '语种', length: '歌名长度' }),
      scrollSeconds: number('滚动速度（数值越大越快）', '45', 1, 100),
      songBoardFontFamily: text('字体', 'Microsoft YaHei'), songBoardFontWeight: fontWeight,
      songBoardSongFontSize: number('歌曲字号', '28', 10, 100), songBoardTitleFontSize: number('标题字号', '24', 10, 100),
      songBoardSongColor: color('歌曲颜色', '#fff7fb'), songBoardThemeText: color('文字颜色', '#fff7fb'),
      songBoardThemePrimary: color('主色', '#ff6f91'), songBoardThemeAccent: color('强调色', '#21b6a8'),
      songBoardThemeBackground: color('背景颜色', '#181823'), songBoardThemeOpacity: number('背景不透明度', '0.35', 0, 1, 0.05),
      songBoardThemeRadius: number('圆角', '8', 0, 60),
    },
  },
  lyrics: {
    title: '桌面歌词', size: [960, 480], path: '/lyrics', variantKey: 'style',
    variants: [variant('default', '桌面歌词', '逐字歌词')],
    fields: {
      style: select('展示样式', 'default', { default: '桌面歌词', moonlit: '月渡花汀' }),
      desktopLyricFontFamily: text('字体', 'Microsoft YaHei'), desktopLyricFontWeight: fontWeight,
      desktopLyricFontSize: number('字号', '56', 24, 72), desktopLyricTextColor: color('文字颜色', '#000000'),
      desktopLyricTextAlign: select('文字对齐', 'left', { left: '左对齐', center: '居中', right: '右对齐' }),
      desktopLyricLineHeight: number('行高', '1.4', 1, 2, 0.1), desktopLyricVisibleLines: number('显示行数（0 为自动）', '0', 0, 99),
      desktopLyricOpacity: number('文字不透明度', '0.95', 0, 1, 0.05),
      desktopLyricKaraokeMode: select('逐字效果', 'continuous', { off: '关闭', continuous: '连续', discrete: '逐字' }),
      desktopLyricShowTranslation: check('显示翻译', 'true'), desktopLyricTranslationScale: number('翻译字号比例', '0.65', 0.4, 1, 0.05),
      desktopLyricHidePassedLines: check('隐藏已唱歌词', 'false'), desktopLyricHideOnPause: check('暂停时隐藏', 'false'),
      desktopLyricStrokeEnabled: check('文字描边', 'true'), desktopLyricStrokeColor: color('描边颜色', '#ffffff'),
      desktopLyricStrokeWidth: number('描边宽度', '3', 0, 6, 0.5), desktopLyricShadowEnabled: check('文字阴影', 'true'),
      desktopLyricTimeOffsetMs: number('歌词偏移（毫秒）', '0', -5000, 5000, 100),
      desktopLyricNoLyricText: text('无歌词提示', '纯音乐，请欣赏'),
    },
  },
  games: {
    title: '直播间互动', category: '直播小游戏', size: [800, 360], path: '/games', variantKey: 'game',
    variants: [variant('number-bomb', '数字炸弹', '1—100'),
      { ...variant('gomoku', '五子棋', 'A1—O15'), size: [600, 600] },
      { ...variant('draw-guess', '你画我猜', '主播画 · 弹幕猜'), size: [1280, 720] }],
    fields: {
      game: select('游戏', 'number-bomb', { 'number-bomb': '数字炸弹', gomoku: '五子棋', 'draw-guess': '你画我猜' }),
      showTitle: check('显示游戏标题'), showDanmaku: check('显示你画我猜弹幕'),
      opacity: number('整体不透明度', 1, 0, 1, 0.05),
    },
  },
  wheel: {
    title: '转盘', category: '直播小游戏', size: [720, 720], path: '/wheel',
    variants: [variant('default', '转转盘', 'GO')],
    fields: { showResult: check('显示抽取结果'), textColor: color('文字颜色', '#ffffff'),
      labelFontSize: number('选项字号', 22, 12, 32), opacity: number('整体不透明度', 1, 0, 1, 0.05) },
  },
  interactions: {
    title: '投票与评分', category: '直播小游戏', size: [800, 600], path: '/interactions', variantKey: 'kind',
    variants: [variant('poll', '弹幕投票', 'A / B / C'), variant('rating', '弹幕评分', '1—10')],
    fields: {
      kind: select('互动类型', 'poll', { poll: '弹幕投票', rating: '弹幕评分' }),
      interactionOverlayTitle: text('标题', '', 60), interactionOverlayHint: text('参与提示', '', 80),
      interactionRatingRules: { ...text('评分规则', '弹幕发送整数 1–10\n重复评分取最后一次', 300), type: 'textarea' },
      interactionTextColor: color('文字颜色', '#172b3a'), interactionBackgroundColor: color('背景颜色', '#ffffff'),
      interactionBackgroundOpacity: number('背景不透明度（%）', '100', 0, 100),
      interactionOverallOpacity: number('整体不透明度（%）', '100', 0, 100),
      interactionBarColor: color('进度条颜色', '#bee9e2'), interactionTrackColor: color('进度条底色', '#f0f3f6'),
      interactionFontSize: number('字号', '20', 16, 24), interactionCornerRadius: number('圆角', '20', 0, 32),
      interactionShowStatus: check('显示状态', 'true'), interactionShowParticipants: check('显示人数', 'true'),
    },
  },
  'gift-frame': {
    title: '礼物边框', size: [1920, 1080], path: '/gift-effects?giftComponent=frame',
    variants: [variant('default', '礼物边框', '林间花信')],
    fields: {},
  },
  'guard-thanks': {
    title: '大航海感谢', size: [2560, 1440], path: '/gift-effects?giftComponent=guard',
    variants: [variant('default', '大航海感谢', '欢迎上舰')],
    fields: { textMode: select('动画文字', 'follow', { follow: '跟随样式设置', bilingual: '中英双语', zh: '中文', en: 'English' }) },
  },
  'gift-feed': {
    title: '礼物滚动', size: [428, 232], path: '/gift-feed',
    variants: [variant('default', '礼物滚动', '感谢投喂')],
    fields: {
      visibleRows: number('显示行数', 3, 1, 10), scrollSpeed: number('滚动速率', 12, 1, 50),
      minGiftAmountCents: number('最低礼物金额（元）', 0, 0, 100000000, 10),
      threshold1: number('第二档金额（元）', 3000, 1, 100000000),
      threshold2: number('第三档金额（元）', 10000, 1, 100000000),
      threshold3: number('第四档金额（元）', 100000, 1, 100000000),
    },
  },
  blindbox: {
    title: '盲盒盈亏榜', size: [480, 640], path: '/blindbox',
    variants: [variant('default', '盲盒盈亏榜', '今日盲盒盈亏')],
    fields: {
      blindboxOverlayTitle: text('标题', '今日盲盒盈亏'), top: number('榜单人数（-1 全部，0 仅汇总）', 3, -1, 10),
      compact: check('紧凑布局', false), winnersOnly: check('只显示榜单', false), hideLoss: check('隐藏亏损观众', false),
      noScroll: check('自动翻页'), themeBackground: color('背景颜色', '#181823'),
      themeOpacity: number('背景不透明度', '0.48', 0, 1, 0.01), themeText: color('文字颜色', '#fff7fb'),
      themePrimary: color('主色', '#ff6f91'), themeAccent: color('强调色', '#21b6a8'),
      overlayFontFamily: text('字体', 'Microsoft YaHei'), overlayFontWeight: fontWeight,
      themeFontScale: number('字号比例', '1', 0.5, 3, 0.1),
    },
  },
  'gift-wishes': {
    title: '礼物许愿', size: [440, 600], path: '/gift-wishes', variantKey: 'displayStyle',
    variants: [variant('card', '许愿卡片', '心愿进度'), variant('text', '文字许愿', '距离目标还差…'), variant('circle', '圆环许愿', '完成进度')],
    fields: {
      period: select('许愿周期', 'all', { all: '全部', long: '长期', day: '每日', session: '本场' }),
      displayStyle: select('展示样式', 'card', { original: '跟随每条许愿', card: '卡片', text: '文字', circle: '圆环', moonlit: '月渡花汀' }),
      showCompleted: check('显示已完成许愿'), limit: number('最多显示条数', 10, 1, 30),
      gap: number('条目间距', 12, 0, 80), textPendingColor: color('当日未收到的文字颜色', '#3b6ea8'),
      textReceivedColor: color('当日已收到的文字颜色', '#21815c'),
    },
  },
  'gift-sprint': {
    title: '月底冲刺', category: 'gift-wishes', size: [600, 80], path: '/gift-sprint',
    variants: [variant('default', '月底冲刺', '还差 100 个水晶球')],
    fields: {},
  },
});

export function createSceneExtraDefaults(type) {
  return Object.fromEntries(Object.entries(SCENE_EXTRA_COMPONENTS[type].fields).map(([key, field]) => [key, field.default]));
}
