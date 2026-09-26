// 编写人：Aurora
// 音乐 API / 歌词缓存管理。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MUSIC_API_CACHE_TTL_MS = 5 * 60 * 1000;
const MUSIC_LYRIC_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MUSIC_API_CACHE_MAX_BYTES = 50 * 1024 * 1024;
const MUSIC_LYRIC_CACHE_MAX_BYTES = 300 * 1024 * 1024;

function musicCacheKey(scope, payload) {
  return crypto
    .createHash('sha1')
    .update(`${scope}:${JSON.stringify(payload || {})}`)
    .digest('hex');
}

function readMusicJsonCache(directory, key, ttlMs) {
  if (!key) return null;
  const filePath = path.join(directory, `${key}.json`);
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > ttlMs) return null;
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return payload && payload.data ? payload.data : null;
  } catch (_) {
    return null;
  }
}

function writeMusicJsonCache(directory, key, data, maxBytes = MUSIC_API_CACHE_MAX_BYTES) {
  if (!key || !data) return;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `${key}.json`),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        data,
      }),
      'utf8',
    );
    pruneMusicCacheDirectory(directory, Number(maxBytes) || MUSIC_API_CACHE_MAX_BYTES);
  } catch (_) {
    /* Cache failures must not affect playback. */
  }
}

function pruneMusicCacheDirectory(directory, maxBytes) {
  const files = listCacheFiles(directory);
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (totalBytes <= maxBytes) break;
    try {
      fs.unlinkSync(file.path);
      totalBytes -= file.size;
    } catch (_) {
      /* ignore */
    }
  }
}

function getDirectoryStats(directory) {
  const files = listCacheFiles(directory);
  return {
    bytes: files.reduce((sum, file) => sum + file.size, 0),
    files: files.length,
  };
}

function listCacheFiles(directory) {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = fs.statSync(filePath);
        return { path: filePath, size: stats.size, mtimeMs: stats.mtimeMs };
      });
  } catch (_) {
    return [];
  }
}

function clearMusicCache(apiDir, lyricDir) {
  const before = {
    api: getDirectoryStats(apiDir),
    lyrics: getDirectoryStats(lyricDir),
  };
  fs.rmSync(apiDir, { recursive: true, force: true });
  fs.rmSync(lyricDir, { recursive: true, force: true });
  fs.mkdirSync(apiDir, { recursive: true });
  fs.mkdirSync(lyricDir, { recursive: true });
  return {
    clearedBytes: before.api.bytes + before.lyrics.bytes,
    clearedFiles: before.api.files + before.lyrics.files,
    after: {
      api: getDirectoryStats(apiDir),
      lyrics: getDirectoryStats(lyricDir),
    },
  };
}

function getMusicCacheStats(apiDir, lyricDir) {
  const api = getDirectoryStats(apiDir);
  const lyrics = getDirectoryStats(lyricDir);
  return {
    api,
    lyrics,
    totalBytes: api.bytes + lyrics.bytes,
    totalFiles: api.files + lyrics.files,
  };
}

module.exports = {
  MUSIC_API_CACHE_TTL_MS,
  MUSIC_LYRIC_CACHE_TTL_MS,
  MUSIC_API_CACHE_MAX_BYTES,
  MUSIC_LYRIC_CACHE_MAX_BYTES,
  musicCacheKey,
  readMusicJsonCache,
  writeMusicJsonCache,
  clearMusicCache,
  getMusicCacheStats,
};
