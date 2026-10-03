'use strict';

const CLIENT_THEME_BACKGROUNDS = Object.freeze({
  neutral: '#f3f3f1',
  classic: '#f7f3ef',
  terracotta: '#f8f5ef',
});

function isClientThemeId(value) {
  return typeof value === 'string' && Object.hasOwn(CLIENT_THEME_BACKGROUNDS, value);
}

function normalizeClientThemeId(value) {
  return isClientThemeId(value) ? value : 'terracotta';
}

module.exports = { CLIENT_THEME_BACKGROUNDS, isClientThemeId, normalizeClientThemeId };
