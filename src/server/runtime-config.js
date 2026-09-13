'use strict';

const path = require('node:path');
const { resolveDataPaths } = require('../shared/data-paths');

function normalizeServerHost(host) {
  const value = String(host || '').trim();
  return !value || value.toLowerCase() === 'localhost' ? '127.0.0.1' : value;
}

function validateServerHost(host) {
  const normalized = normalizeServerHost(host);
  if (normalized !== '127.0.0.1') {
    throw new Error(
      `Host must be '127.0.0.1' or 'localhost' (got '${host}'). ` +
        'Remote binding (0.0.0.0, LAN addresses) is not supported for security.',
    );
  }
  return normalized;
}

function resolveServerRuntimeConfig(rootDir, runtimeOptions = {}) {
  const dataDir = runtimeOptions.dataDir
    ? path.resolve(runtimeOptions.dataDir)
    : process.env.SONG_PLUGIN_DATA_DIR
      ? path.resolve(process.env.SONG_PLUGIN_DATA_DIR)
      : path.join(rootDir, 'data');
  const paths = resolveDataPaths(dataDir);

  return {
    HOST: validateServerHost(runtimeOptions.host || process.env.HOST),
    DATA_DIR: dataDir,
    SONG_DB_PATH: path.join(dataDir, 'song-request-data.db'),
    SUPER_CHAT_DB_PATH: path.join(dataDir, 'super-chat-data.db'),
    GIFT_DB_PATH: path.join(dataDir, 'gift-data.db'),
    MUSIC_DB_PATH: path.join(dataDir, 'music-data.db'),
    CHECKIN_DB_PATH: path.join(dataDir, 'checkin-data.db'),
    MUSIC_API_CACHE_DIR: paths.musicApiCacheDir,
    MUSIC_LYRIC_CACHE_DIR: paths.musicLyricsCacheDir,
    OPENING_MUSIC_DIR: path.join(dataDir, 'opening-music'),
    AI_LOG_PATH: path.join(path.dirname(dataDir), 'logs', 'ai.log'),
  };
}

module.exports = {
  normalizeServerHost,
  validateServerHost,
  resolveServerRuntimeConfig,
};
