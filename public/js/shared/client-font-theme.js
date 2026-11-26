import { SHARED_FONTS } from './font-catalog.js';

export const CLIENT_FONT_SOURCES = Object.freeze({
  shared: Object.freeze(['wenkai', 'xiaolai', 'yozai', 'source-han-serif', 'maiyuan', 'assorted', 'smiley', 'kuaile']),
  local: Object.freeze([
    ['DengXian', '等线'],
    ['SimSun', '宋体'],
    ['KaiTi', '楷体'],
    ['FangSong', '仿宋'],
    ['SimHei', '黑体'],
  ].map(([family, label]) => Object.freeze({
    id: family.toLowerCase(), family, label, value: `"${family}"`, local: true,
  }))),
});

export const CLIENT_FONTS = Object.freeze([
  ...SHARED_FONTS.filter(font => CLIENT_FONT_SOURCES.shared.includes(font.id)),
  ...CLIENT_FONT_SOURCES.local,
]);
export const CLIENT_FONT_IDS = Object.freeze(CLIENT_FONTS.map(font => font.id));
export const DEFAULT_CLIENT_FONT_ID = 'system';

export function isClientFontId(id) {
  return id === DEFAULT_CLIENT_FONT_ID || CLIENT_FONT_IDS.includes(id);
}

export function clientFontById(id) {
  return CLIENT_FONTS.find(font => font.id === id);
}
