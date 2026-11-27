export const DEFAULT_CLIENT_THEME_ID = 'terracotta';

export const CLIENT_THEME_CATEGORIES = Object.freeze([
  { id: 'warm-earth', label: '暖调大地', order: 1 },
  { id: 'rose-plum', label: '玫瑰梅紫', order: 2 },
  { id: 'botanical', label: '青绿森系', order: 3 },
  { id: 'cool-blue', label: '冰青蓝调', order: 4 },
  { id: 'monochrome', label: '极简中性', order: 5 },
  { id: 'polychrome', label: '复合艺彩', order: 6 },
].map(Object.freeze));

export const CLIENT_THEME_CATEGORY_MAP = Object.freeze(
  Object.fromEntries(CLIENT_THEME_CATEGORIES.map((category) => [category.id, category])),
);

export const CLIENT_THEMES = Object.freeze([
  // 日间浅色（16 套）
  { id: 'terracotta', name: '暖陶', background: '#f8f5ef', mode: 'light', category: 'warm-earth', surface: 'solid', family: null, temperature: 'warm' },
  { id: 'classic', name: '经典暖金', background: '#f7f3ef', mode: 'light', category: 'warm-earth', surface: 'solid', family: null, temperature: 'warm' },
  { id: 'honey-amber', name: '蜜珀 · 暖阳', background: '#faf2d8', mode: 'light', category: 'warm-earth', surface: 'solid', family: null, temperature: 'warm' },
  { id: 'neutral', name: '中性蓝', background: '#f3f3f1', mode: 'light', category: 'monochrome', surface: 'solid', family: null, temperature: 'neutral' },
  { id: 'ink-paper', name: '素墨 · 宣纸', background: '#f0efeb', mode: 'light', category: 'monochrome', surface: 'solid', family: null, temperature: 'neutral' },
  { id: 'clear-jade', name: '清白 · 翠光', background: '#ecf0f1', mode: 'light', category: 'botanical', surface: 'solid', family: null, temperature: 'cool' },
  { id: 'moss-linen', name: '雾苔 · 亚麻', background: '#f0f1e9', mode: 'light', category: 'botanical', surface: 'solid', family: null, temperature: 'neutral' },
  { id: 'celadon-mist', name: '青瓷 · 烟岚', background: '#c6d6d6', mode: 'light', category: 'botanical', surface: 'tinted', family: null, temperature: 'cool' },
  { id: 'glacier-cyan', name: '晴岚 · 冰青', background: '#dff0fa', mode: 'light', category: 'cool-blue', surface: 'gradient', family: 'glacier-abyss', temperature: 'cool' },
  { id: 'dusty-rose', name: '烟粉 · 灰玫瑰', background: '#d4b6bd', mode: 'light', category: 'rose-plum', surface: 'tinted', family: null, temperature: 'warm' },
  { id: 'rose-plum-light', name: '梅雾 · 浅色', background: '#faebdf', mode: 'light', category: 'rose-plum', surface: 'gradient', family: 'rose-plum', temperature: 'warm' },
  { id: 'lotus-violet-light', name: '紫岚 · 浅色', background: '#f3e5e4', mode: 'light', category: 'rose-plum', surface: 'gradient', family: 'lotus-violet', temperature: 'hybrid' },
  { id: 'rose-lustre', name: '玫瑰映光', background: '#faf1f4', mode: 'light', category: 'polychrome', surface: 'gradient', family: null, temperature: 'hybrid' },
  { id: 'opal-indigo', name: '云母 · 靛光', background: '#f1effa', mode: 'light', category: 'polychrome', surface: 'gradient', family: null, temperature: 'hybrid' },
  { id: 'travertine-verdigris', name: '砂岩 · 孔雀釉', background: '#eae1d0', mode: 'light', category: 'polychrome', surface: 'tinted', family: null, temperature: 'hybrid' },
  { id: 'dawn-persimmon', name: '朝霞 · 柿釉', background: '#dfe9f2', mode: 'light', category: 'polychrome', surface: 'gradient', family: null, temperature: 'hybrid' },
  // 夜间深色（8 套）
  { id: 'cocoa-champagne', name: '墨咖 · 香槟', background: '#1c1916', mode: 'dark', category: 'warm-earth', surface: 'solid', family: null, temperature: 'warm' },
  { id: 'ember-slate', name: '炭墨 · 炽橙', background: '#12151c', mode: 'dark', category: 'warm-earth', surface: 'solid', family: null, temperature: 'hybrid' },
  { id: 'black-silver', name: '玄黑 · 银红', background: '#080a0c', mode: 'dark', category: 'monochrome', surface: 'solid', family: null, temperature: 'neutral' },
  { id: 'pine-jade', name: '松墨 · 青玉', background: '#0d1613', mode: 'dark', category: 'botanical', surface: 'solid', family: null, temperature: 'cool' },
  { id: 'abyss-cyan', name: '沧渊 · 冰青', background: '#0a151e', mode: 'dark', category: 'cool-blue', surface: 'gradient', family: 'glacier-abyss', temperature: 'cool' },
  { id: 'midnight-cobalt', name: '曜蓝 · 星夜', background: '#0f1421', mode: 'dark', category: 'cool-blue', surface: 'solid', family: null, temperature: 'cool' },
  { id: 'rose-plum-dark', name: '梅雾 · 深色', background: '#291f23', mode: 'dark', category: 'rose-plum', surface: 'gradient', family: 'rose-plum', temperature: 'warm' },
  { id: 'lotus-violet-dark', name: '紫岚 · 深色', background: '#29252f', mode: 'dark', category: 'rose-plum', surface: 'gradient', family: 'lotus-violet', temperature: 'hybrid' },
].map(Object.freeze));

export const CLIENT_THEME_BY_ID = Object.freeze(
  Object.fromEntries(CLIENT_THEMES.map((theme) => [theme.id, theme])),
);

export const CLIENT_THEME_BACKGROUNDS = Object.freeze(
  Object.fromEntries(CLIENT_THEMES.map(({ id, background }) => [id, background])),
);

export function isClientThemeId(value) {
  return typeof value === 'string' && Object.hasOwn(CLIENT_THEME_BY_ID, value);
}

export function resolveClientThemeId(value) {
  if (isClientThemeId(value)) return value;
  return null;
}

export function normalizeClientThemeId(value) {
  return resolveClientThemeId(value) ?? DEFAULT_CLIENT_THEME_ID;
}

export function getClientTheme(value) {
  return CLIENT_THEME_BY_ID[normalizeClientThemeId(value)];
}
