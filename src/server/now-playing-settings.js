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

function patchNowPlayingConfig(context, patch) {
  // The desktop owns the default record style; each canvas widget owns its part.
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || !Object.keys(patch).length || Object.hasOwn(patch, 'nowPlayingPart')) {
    throw Object.assign(new Error('歌曲信息外观补丁无效。'), { statusCode: 400 });
  }
  const current = readNowPlayingConfig(context.settings.get());
  return saveNowPlayingConfig(context, { ...current, ...patch });
}

module.exports = { NOW_PLAYING_SETTING, readNowPlayingConfig, normalizeNowPlayingSetting, saveNowPlayingConfig, patchNowPlayingConfig };
