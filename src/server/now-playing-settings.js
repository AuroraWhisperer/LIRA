'use strict';

const { normalizeSceneExtraConfig } = require('./scene-extra-config');
const { NOW_PLAYING_DEFAULTS } = require('../../public/js/shared/now-playing-appearance.js');

const NOW_PLAYING_SETTING = 'nowPlayingAppearance';

function readNowPlayingConfig(settings = {}) {
  try {
    return normalizeSceneExtraConfig('now-playing', JSON.parse(settings[NOW_PLAYING_SETTING] || '{}'));
  } catch {
    return { ...NOW_PLAYING_DEFAULTS };
  }
}

function normalizeNowPlayingSetting(value) {
  if (typeof value !== 'string' || value.length > 16384) return null;
  try {
    return JSON.stringify(normalizeSceneExtraConfig('now-playing', JSON.parse(value)));
  } catch {
    return null;
  }
}

function saveNowPlayingConfig(context, config) {
  const normalized = normalizeSceneExtraConfig('now-playing', config);
  context.settings.setMany({ [NOW_PLAYING_SETTING]: JSON.stringify(normalized) });
  context.broadcastSnapshot('settings');
  return normalized;
}

module.exports = { NOW_PLAYING_SETTING, readNowPlayingConfig, normalizeNowPlayingSetting, saveNowPlayingConfig };
