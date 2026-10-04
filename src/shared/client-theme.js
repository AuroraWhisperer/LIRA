'use strict';

const DEFAULT_CLIENT_THEME_ID = 'terracotta';
const CLIENT_THEMES = Object.freeze([
  { id: 'neutral', name: '中性蓝', background: '#f3f3f1' },
  { id: 'classic', name: '经典暖金', background: '#f7f3ef' },
  { id: 'terracotta', name: '暖陶', background: '#f8f5ef' },
  { id: 'clear-jade', name: '清白 · 翠光', background: '#ecf0f1' },
  { id: 'black-silver', name: '玄黑 · 银红', background: '#080a0c' },
  { id: 'rose-lustre', name: '玫瑰映光', background: '#faf1f4' },
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
