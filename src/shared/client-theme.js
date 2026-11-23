'use strict';

const DEFAULT_CLIENT_THEME_ID = 'terracotta';
const CLIENT_THEMES = Object.freeze([
  { id: 'terracotta', name: '暖陶', background: '#f8f5ef', mode: 'light' },
  { id: 'classic', name: '经典暖金', background: '#f7f3ef', mode: 'light' },
  { id: 'neutral', name: '中性蓝', background: '#f3f3f1', mode: 'light' },
  { id: 'clear-jade', name: '清白 · 翠光', background: '#ecf0f1', mode: 'light' },
  { id: 'moss-linen', name: '雾苔 · 亚麻', background: '#f0f1e9', mode: 'light' },
  { id: 'dusty-rose', name: '烟粉 · 灰玫瑰', background: '#d4b6bd', mode: 'light' },
  { id: 'rose-lustre', name: '玫瑰映光', background: '#faf1f4', mode: 'light' },
  { id: 'rose-plum-light', name: '梅雾 · 浅色', background: '#faebdf', mode: 'light' },
  { id: 'lotus-violet-light', name: '紫岚 · 浅色', background: '#f3e5e4', mode: 'light' },
  { id: 'cocoa-champagne', name: '墨咖 · 香槟', background: '#1c1916', mode: 'dark' },
  { id: 'black-silver', name: '玄黑 · 银红', background: '#080a0c', mode: 'dark' },
  { id: 'rose-plum-dark', name: '梅雾 · 深色', background: '#291f23', mode: 'dark' },
  { id: 'lotus-violet-dark', name: '紫岚 · 深色', background: '#29252f', mode: 'dark' },
].map(Object.freeze));
const CLIENT_THEME_BACKGROUNDS = Object.freeze(Object.fromEntries(
  CLIENT_THEMES.map(({ id, background }) => [id, background]),
));

function isClientThemeId(value) {
  return typeof value === 'string' && Object.hasOwn(CLIENT_THEME_BACKGROUNDS, value);
}

function normalizeClientThemeId(value) {
  return isClientThemeId(value) ? value : DEFAULT_CLIENT_THEME_ID;
}

module.exports = { CLIENT_THEMES, DEFAULT_CLIENT_THEME_ID, CLIENT_THEME_BACKGROUNDS, isClientThemeId, normalizeClientThemeId };
