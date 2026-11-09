export const WEEKLY_LAYOUTS = Object.freeze([
  { id: 'scrapbook', label: '活页手账' },
  { id: 'celestial', label: '星夜来信' },
  { id: 'broadcast', label: '复古放送单' },
  { id: 'week-grid', label: '横向七日表' },
  { id: 'magazine', label: '杂志封面' },
  { id: 'scroll', label: '国风卷轴' },
].map(item => Object.freeze(item)));

export const WEEKLY_PALETTES = Object.freeze([
  { id: 'cheese', label: '芝士黄', primaryColor: '#f4cc49', accentColor: '#825a36' },
  { id: 'pink', label: '樱花粉', primaryColor: '#e89bb7', accentColor: '#67b8d1' },
  { id: 'sea', label: '海盐蓝', primaryColor: '#78b6da', accentColor: '#df96b9' },
  { id: 'matcha', label: '抹茶绿', primaryColor: '#91b95c', accentColor: '#4c9f99' },
  { id: 'purple', label: '水水紫', primaryColor: '#9672b9', accentColor: '#efcf66' },
  { id: 'orange', label: '奶橘', primaryColor: '#efad72', accentColor: '#73bda7' },
  { id: 'mint', label: '薄荷', primaryColor: '#77bfaa', accentColor: '#e59ab6' },
  { id: 'night', label: '夜幕', primaryColor: '#414f86', accentColor: '#88bcde' },
  { id: 'rose', label: '玫瑰灰', primaryColor: '#c29099', accentColor: '#625c75' },
  { id: 'coffee', label: '拿铁', primaryColor: '#c4a78a', accentColor: '#70544b' },
  { id: 'jade', label: '青玉', primaryColor: '#669b91', accentColor: '#bd9555' },
  { id: 'ink', label: '墨与朱', primaryColor: '#64717b', accentColor: '#bd6353' },
].map(item => Object.freeze(item)));

export const WEEKLY_ICONS = Object.freeze([
  { id: 'heart', label: '爱心' }, { id: 'star', label: '星星' },
  { id: 'paw', label: '猫爪' }, { id: 'flower', label: '花朵' },
  { id: 'bow', label: '蝴蝶结' }, { id: 'bell', label: '铃铛' },
  { id: 'moon', label: '月亮' }, { id: 'cloud', label: '云朵' },
  { id: 'cat', label: '猫猫' }, { id: 'rabbit', label: '兔兔' },
  { id: 'talisman', label: '符纸' },
].map(item => Object.freeze(item)));

export const WEEKLY_FONTS = Object.freeze([
  { id: 'source-han-sans', label: '思源黑体', value: 'Noto Sans SC, Noto Sans JP, Microsoft YaHei, sans-serif' },
  { id: 'kuaile', label: '站酷快乐体', value: '"Lira Kuaile"' },
  { id: 'xiaowei', label: '站酷小薇', value: '"ZCOOL XiaoWei", "站酷小薇", serif' },
  { id: 'mashanzheng', label: '马善政', value: '"Lira Mashanzheng"' },
].map(item => Object.freeze(item)));

export const ASSET_KEYS = Object.freeze([
  'portrait', 'chibi', 'logo', 'background', 'qrcode', 'rank1', 'rank2', 'rank3', 'icon',
]);

export const MAX_ASSET_BYTES = 12 * 1024 * 1024;
export const MAX_TEMPLATE_ASSET_BYTES = 48 * 1024 * 1024;
export const WEEKLY_IMAGE_RANGES = Object.freeze({
  scale: { min: 10, max: 400, value: 100, unit: '%' },
  x: { min: -1920, max: 1920, value: 0, unit: 'px' },
  y: { min: -1080, max: 1080, value: 0, unit: 'px' },
  rotation: { min: -180, max: 180, value: 0, unit: '°' },
  opacity: { min: 0, max: 100, value: 100, unit: '%' },
});
export const WEEKLY_BACKGROUND_RANGES = Object.freeze({
  x: { min: 0, max: 100, value: 50, unit: '%' },
  y: { min: 0, max: 100, value: 50, unit: '%' },
  opacity: { min: 0, max: 100, value: 100, unit: '%' },
  blur: { min: 0, max: 24, value: 0, unit: 'px' },
});
export const WEEKLY_TYPE_RANGES = Object.freeze({
  title: { min: 50, max: 150, value: 100, unit: '%' },
  theme: { min: 70, max: 160, value: 100, unit: '%' },
  note: { min: 70, max: 160, value: 100, unit: '%' },
  time: { min: 70, max: 160, value: 100, unit: '%' },
});
export const WEEKLY_PATTERNS = Object.freeze([
  { id: 'none', label: '纯色' }, { id: 'gingham', label: '格纹' },
  { id: 'dots', label: '波点' }, { id: 'grid', label: '方格' },
  { id: 'hearts', label: '小爱心' }, { id: 'stripes', label: '斜纹' },
  { id: 'diamonds', label: '菱格' },
]);
export const WEEKLY_TEXT_LIMITS = Object.freeze({
  name: 60,
  title: 40,
  weekLabel: 30,
  streamerName: 40,
  theme: 36,
  note: 48,
  time: 32,
  highlightLabel: 20,
  moduleTitle: 30,
  message: 600,
  rankSubtitle: 60,
  rankName: 30,
  qrCaption: 60,
  benefits: 500,
});
const MAX_ASSET_URL_LENGTH = Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 64;

function text(value, fallback = '', limit = 120) {
  if (typeof value !== 'string') return fallback;
  return Array.from(value.replace(/\u0000/g, '')).slice(0, limit).join('');
}

function oneOf(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function number(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function flag(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function dateValue(date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return dateValue(date) === value ? date : null;
}

function today() {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function getWeekDates(value) {
  const date = parseDate(value) || parseDate(today());
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + index);
    return dateValue(day);
  });
}

export function isWeeklyScheduleAsset(value) {
  if (typeof value !== 'string' || value.length > MAX_ASSET_URL_LENGTH) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
  if (match[2].length / 4 * 3 - padding > MAX_ASSET_BYTES) return false;
  let header;
  try {
    header = atob(match[2].slice(0, 32));
  } catch {
    return false;
  }
  if (match[1] === 'png') return header.startsWith('\x89PNG\r\n\x1a\n');
  if (match[1] === 'jpeg') return header.startsWith('\xff\xd8\xff');
  return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
}

export function getWeeklyScheduleAssetBytes(value) {
  if (!isWeeklyScheduleAsset(value)) return 0;
  const length = value.length - value.indexOf(',') - 1;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return length / 4 * 3 - padding;
}

function createTemplateId() {
  return globalThis.crypto?.randomUUID?.() || `weekly-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parameters(input, ranges) {
  return Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key,
    number(input?.[key], range.value, range.min, range.max)]));
}

function transform(value = {}, portrait = false) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {
    ...parameters(input, WEEKLY_IMAGE_RANGES),
    flip: flag(input.flip, false),
  };
  if (portrait) {
    result.outline = flag(input.outline, true);
  }
  return result;
}

export function normalizeWeeklyScheduleTemplate(value) {
  const input = value && typeof value === 'object' ? value : {};
  const modules = input.modules || {};
  const message = modules.message || {};
  const rank = modules.rank || {};
  const qr = modules.qr || {};
  const benefits = modules.benefits || {};
  const decorations = input.decorations || {};
  const palette = WEEKLY_PALETTES.find(item => item.id === input.palette) || WEEKLY_PALETTES[0];
  const color = (value, fallback) => /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  const font = typeof input.fontId === 'string' && input.fontId.length <= 200
    && /^[\p{L}\p{N}\s_,'".\-]+$/u.test(input.fontId) ? input.fontId : WEEKLY_FONTS[0].value;
  return {
    id: text(input.id, '', 100).trim() || createTemplateId(),
    name: text(input.name, '我的周表', WEEKLY_TEXT_LIMITS.name).trim() || '我的周表',
    layout: oneOf(input.layout, WEEKLY_LAYOUTS.map(item => item.id), 'scrapbook'),
    palette: palette.id,
    primaryColor: color(input.primaryColor, palette.primaryColor),
    accentColor: color(input.accentColor, palette.accentColor),
    icon: input.icon === 'custom' && isWeeklyScheduleAsset(input.assets?.icon)
      ? 'custom' : oneOf(input.icon, WEEKLY_ICONS.map(item => item.id), 'heart'),
    iconTint: flag(input.iconTint, false),
    title: text(input.title, 'Schedule', WEEKLY_TEXT_LIMITS.title),
    weekLabel: text(input.weekLabel, '每周日程', WEEKLY_TEXT_LIMITS.weekLabel),
    streamerName: text(input.streamerName, '', WEEKLY_TEXT_LIMITS.streamerName),
    weekdayFormat: oneOf(input.weekdayFormat, ['en', 'zh', 'short'], 'en'),
    fontId: font,
    monday: getWeekDates(input.monday)[0],
    showDates: flag(input.showDates, true),
    flippedLayout: flag(input.flippedLayout, false),
    showCredit: flag(input.showCredit, true),
    assets: Object.fromEntries(ASSET_KEYS.map(key => [key, isWeeklyScheduleAsset(input.assets?.[key]) ? input.assets[key] : ''])),
    portrait: transform(input.portrait, true),
    logo: transform(input.logo),
    chibi: transform(input.chibi),
    background: {
      ...parameters(input.background, WEEKLY_BACKGROUND_RANGES),
      fit: oneOf(input.background?.fit, ['cover', 'contain'], 'cover'),
    },
    typography: parameters(input.typography, WEEKLY_TYPE_RANGES),
    days: Array.from({ length: 7 }, (_, index) => {
      const day = input.days?.[index] || {};
      return {
        theme: text(day.theme, '', WEEKLY_TEXT_LIMITS.theme),
        note: text(day.note, '', WEEKLY_TEXT_LIMITS.note),
        time1: text(day.time1, '20:00', WEEKLY_TEXT_LIMITS.time),
        time2: text(day.time2, '', WEEKLY_TEXT_LIMITS.time),
        rest: flag(day.rest, false),
        highlight: flag(day.highlight, false),
        highlightLabel: text(day.highlightLabel, '活动', WEEKLY_TEXT_LIMITS.highlightLabel),
      };
    }),
    modules: {
      message: { enabled: flag(message.enabled, true), title: text(message.title, '留言板', WEEKLY_TEXT_LIMITS.moduleTitle), text: text(message.text, '', WEEKLY_TEXT_LIMITS.message) },
      rank: { enabled: flag(rank.enabled, true), title: text(rank.title, '上周榜单', WEEKLY_TEXT_LIMITS.moduleTitle), subtitle: text(rank.subtitle, '谢谢大家的支持', WEEKLY_TEXT_LIMITS.rankSubtitle),
        names: Array.from({ length: 3 }, (_, index) => text(rank.names?.[index], '', WEEKLY_TEXT_LIMITS.rankName)) },
      qr: { enabled: flag(qr.enabled, false), caption: text(qr.caption, '扫码加入粉丝群', WEEKLY_TEXT_LIMITS.qrCaption) },
      benefits: { enabled: flag(benefits.enabled, false), title: text(benefits.title, '上舰福利', WEEKLY_TEXT_LIMITS.moduleTitle), text: text(benefits.text, '', WEEKLY_TEXT_LIMITS.benefits) },
    },
    decorations: {
      pattern: oneOf(decorations.pattern, WEEKLY_PATTERNS.map(item => item.id), 'gingham'),
      intensity: number(decorations.intensity, 100, 0, 100),
      lace: flag(decorations.lace, true),
      sparkles: flag(decorations.sparkles, true),
      tape: flag(decorations.tape, true),
      bow: flag(decorations.bow, true),
      backgroundIcons: flag(decorations.backgroundIcons, true),
    },
  };
}

export function createWeeklyScheduleTemplate({ id, name, monday } = {}) {
  return normalizeWeeklyScheduleTemplate({ id, name, monday });
}

export function cloneWeeklyScheduleTemplate(template, { id, name } = {}) {
  return normalizeWeeklyScheduleTemplate({ ...template, id: id || createTemplateId(), name: name ?? `${template.name} 副本` });
}

export function clearWeeklyScheduleWeek(template) {
  const result = normalizeWeeklyScheduleTemplate(template);
  result.days.forEach(day => {
    day.theme = '';
    day.note = '';
    day.rest = false;
    day.highlight = false;
    day.highlightLabel = '活动';
  });
  return result;
}
