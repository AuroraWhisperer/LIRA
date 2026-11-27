export const DEFAULT_BLINDBOX_STYLE = 'classic';

export const BLINDBOX_STYLES = Object.freeze([
  Object.freeze({
    id: 'classic',
    label: '经典暗夜',
    shortLabel: '经典',
    description: '原版深色样式，颜色跟随点歌板主题',
    tone: 'dark',
    swatches: ['#181823', '#ff6f91', '#21b6a8'],
  }),
  Object.freeze({
    id: 'porcelain',
    label: '霜瓷双栏',
    shortLabel: '霜瓷',
    description: '左总账右榜单紧凑双区，暖白瓷面适配亮色画面',
    tone: 'light',
    swatches: ['#fdfaf5', '#c8a46e', '#0c7a5c'],
  }),
  Object.freeze({
    id: 'layers',
    label: '无界切片',
    shortLabel: '切片',
    description: '去大外框悬浮薄片 + 高对比盈亏主碑',
    tone: 'light',
    swatches: ['#f8f9fb', '#0e7f63', '#e0a943'],
  }),
  Object.freeze({
    id: 'prism',
    label: '琉璃雅集',
    shortLabel: '琉璃',
    description: '冰晶冷调灰蓝磨砂单板，静奢圆环序标',
    tone: 'light',
    swatches: ['#eef3f8', '#7d92ad', '#0b7b63'],
  }),
  Object.freeze({
    id: 'podium',
    label: '浅金席卡',
    shortLabel: '席卡',
    description: '象牙描金微方角，Top 3 横向三席极致省高',
    tone: 'light',
    swatches: ['#fbf6ec', '#b68a3e', '#11795d'],
  }),
]);

export const BLINDBOX_STYLE_IDS = Object.freeze(BLINDBOX_STYLES.map(style => style.id));

export const BLINDBOX_STYLE_OPTIONS = Object.freeze(
  Object.fromEntries(BLINDBOX_STYLES.map(style => [style.id, style.label])),
);

export function normalizeBlindboxStyle(value) {
  const key = String(value || '').trim();
  return BLINDBOX_STYLE_IDS.includes(key) ? key : DEFAULT_BLINDBOX_STYLE;
}
