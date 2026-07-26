// 编写人：Aurora
// 音乐 API / 歌词缓存管理。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MUSIC_API_CACHE_TTL_MS = 5 * 60 * 1000;
const MUSIC_LYRIC_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function musicCacheKey(scope, payload) {
  return crypto.createHash('sha1')
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
  } catch (_) { return null; }
}

function writeMusicJsonCache(directory, key, data) {
  if (!key || !data) return;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${key}.json`), JSON.stringify({
      savedAt: new Date().toISOString(), data
    }), 'utf8');
    pruneMusicCacheDirectory(directory, directory.includes('lyrics') ? 300 * 1024 * 1024 : 50 * 1024 * 1024);
  } catch (_) { /* Cache failures must not affect playback. */ }
}

function pruneMusicCacheDirectory(directory, maxBytes) {
  const files = listCacheFiles(directory);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break;
    try { fs.unlinkSync(file.path); total -= file.size; } catch (_) { /* ignore */ }
  }
}

function getDirectoryStats(directory) {
  const files = listCacheFiles(directory);
  return { bytes: files.reduce((sum, f) => sum + f.size, 0), files: files.length };
}

function listCacheFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => {
        const fp = path.join(directory, e.name);
        const st = fs.statSync(fp);
        return { path: fp, size: st.size, mtimeMs: st.mtimeMs };
      });
  } catch (_) { return []; }
}

function clearMusicCache(apiDir, lyricDir) {
  const before = { api: getDirectoryStats(apiDir), lyrics: getDirectoryStats(lyricDir) };
  fs.rmSync(apiDir, { recursive: true, force: true });
  fs.rmSync(lyricDir, { recursive: true, force: true });
  fs.mkdirSync(apiDir, { recursive: true });
  fs.mkdirSync(lyricDir, { recursive: true });
  return {
    clearedBytes: before.api.bytes + before.lyrics.bytes,
    clearedFiles: before.api.files + before.lyrics.files,
    after: { api: getDirectoryStats(apiDir), lyrics: getDirectoryStats(lyricDir) }
  };
}

function getMusicCacheStats(apiDir, lyricDir) {
  return {
    api: getDirectoryStats(apiDir),
    lyrics: getDirectoryStats(lyricDir),
    totalBytes: getDirectoryStats(apiDir).bytes + getDirectoryStats(lyricDir).bytes,
    totalFiles: getDirectoryStats(apiDir).files + getDirectoryStats(lyricDir).files
  };
}

module.exports = {
  musicCacheKey,
  readMusicJsonCache,
  writeMusicJsonCache,
  clearMusicCache,
  getMusicCacheStats
};
