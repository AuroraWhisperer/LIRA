'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { decryptQrc } = require('qrc-decoder');
const { parseLyricResult } = require('./lyric-parser');
const { decodeXmlEntities } = require('./qrc-xml-entities');

const LOG_TAIL_BYTES = 100 * 1024;
const MAX_LOG_SCAN_BYTES = 4 * 1024 * 1024;
const MAX_QRC_BYTES = 4 * 1024 * 1024;
const MAX_FALLBACK_FILES = 80;
const MAX_QRC_CACHE_BYTES = 16 * 1024 * 1024;
const MIN_LYRIC_OFFSET_MS = -3000;
const MAX_LYRIC_OFFSET_MS = 3000;
const SAFE_SONG_MID = /^[a-zA-Z0-9_-]{1,128}$/;

function normalizeWeSingCachePath(input) {
  const value = String(input || '')
    .trim()
    .replace(/^"|"$/g, '');
  if (!value) throw new Error('请选择全民 K 歌的 WeSingCache 目录。');
  if (value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('WeSingCache 路径无效。');
  }
  if (!path.isAbsolute(value) && !path.win32.isAbsolute(value)) {
    throw new Error('WeSingCache 必须使用绝对路径。');
  }
  const resolved = path.resolve(value);
  if (path.basename(resolved).toLowerCase() !== 'wesingcache') {
    throw new Error('请选择名称为 WeSingCache 的目录。');
  }
  return resolved;
}

function normalizeWeSingLyricOffsetMs(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) throw new Error('歌词时间偏移必须是数字。');
  const rounded = Math.round(value);
  if (rounded < MIN_LYRIC_OFFSET_MS || rounded > MAX_LYRIC_OFFSET_MS) {
    throw new Error(`歌词时间偏移必须在 ${MIN_LYRIC_OFFSET_MS} 到 ${MAX_LYRIC_OFFSET_MS} 毫秒之间。`);
  }
  return rounded;
}

async function ensureWeSingCacheDirectory(input) {
  const cachePath = normalizeWeSingCachePath(input);
  if (!(await hasWeSingCacheData(cachePath))) {
    throw new Error('未找到全民 K 歌缓存文件。请先在全民 K 歌播放一首伴奏，再选择实际使用的 WeSingCache 文件夹。');
  }
  return cachePath;
}

async function hasWeSingCacheData(input) {
  const cachePath = safeInitialCachePath(input);
  if (!cachePath) return false;
  const logDir = path.join(cachePath, 'Log', 'WeSing');
  const entries = await fs.promises.readdir(logDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue;
    const stat = await fs.promises.stat(path.join(logDir, entry.name)).catch(() => null);
    if (stat?.isFile() && stat.size > 0) return true;
  }
  for await (const candidates of readQrcFileBatches(path.join(cachePath, 'WeSingDL', 'Res'))) {
    if (candidates.length > 0) return true;
  }
  return false;
}

async function findLatestWeSingLog(cachePath) {
  const latest = (await scanWeSingLogs(cachePath)).latest;
  if (!latest) return null;
  const { filePath, modifiedMs, size } = latest;
  return { filePath, modifiedMs, size };
}

async function scanWeSingLogs(cachePath) {
  const basePath = normalizeWeSingCachePath(cachePath);
  const logDir = path.join(basePath, 'Log', 'WeSing');
  let entries;
  try {
    entries = await fs.promises.readdir(logDir, { withFileTypes: true });
  } catch (_) {
    return { latest: null, hasData: false };
  }

  let latest = null;
  let hasData = false;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue;
    const filePath = path.join(logDir, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      const log = { filePath, modifiedMs: stat.mtimeMs, size: stat.size,
        fingerprint: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}` };
      if (!latest || log.modifiedMs > latest.modifiedMs) latest = log;
      if (stat.size > 0) hasData = true;
    } catch (_) {}
  }
  return { latest, hasData };
}

async function findLatestSongEntry(cachePath, expectedTitle = '') {
  const latest = await findLatestWeSingLog(cachePath);
  return matchingSongEntry(await readSongEntry(latest), expectedTitle);
}

function matchingSongEntry(entry, expectedTitle) {
  const title = normalizeTitle(expectedTitle);
  return entry && (!title || normalizeTitle(entry.songName) === title) ? { ...entry } : null;
}

function createWeSingCacheReader() {
  const entries = new Map();
  const qrcEntries = new Map();
  let qrcBytes = 0;
  let generation = 0;

  function removeQrc(filePath) {
    qrcBytes -= qrcEntries.get(filePath)?.bytes || 0;
    qrcEntries.delete(filePath);
  }

  async function readQrc(filePath) {
    const version = generation;
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0 || stat.size > MAX_QRC_BYTES) {
      if (version === generation) removeQrc(filePath);
      return null;
    }
    if (version !== generation) return tryReadQrc(filePath, stat);
    const fingerprint = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}`;
    let entry = qrcEntries.get(filePath);
    if (entry?.fingerprint === fingerprint) {
      qrcEntries.delete(filePath);
      qrcEntries.set(filePath, entry);
      return entry.promise;
    }
    removeQrc(filePath);
    entry = { fingerprint, bytes: 0, promise: null };
    entry.promise = tryReadQrc(filePath, stat).then((parsed) => {
      if (qrcEntries.get(filePath) !== entry) return parsed;
      // Partial downloads and transient read failures must be retried next time.
      if (!parsed?.lines.length) {
        removeQrc(filePath);
      } else {
        entry.bytes = JSON.stringify(parsed).length * 2;
        qrcBytes += entry.bytes;
        while (qrcBytes > MAX_QRC_CACHE_BYTES) removeQrc(qrcEntries.keys().next().value);
      }
      return parsed;
    });
    qrcEntries.set(filePath, entry);
    while (qrcEntries.size > MAX_FALLBACK_FILES) removeQrc(qrcEntries.keys().next().value);
    return entry.promise;
  }

  async function read(input, title = '') {
    const cachePath = safeInitialCachePath(input);
    if (!cachePath) return { cacheReady: false, log: null, logEntry: null };
    // Probe metadata every time so rotation and cache moves recover without watcher events.
    const { latest: log, hasData } = await scanWeSingLogs(cachePath);
    let cacheReady = hasData;
    if (!cacheReady) {
      for await (const candidates of readQrcFileBatches(path.join(cachePath, 'WeSingDL', 'Res'))) {
        if (candidates.length) { cacheReady = true; break; }
      }
    }
    let logEntry = null;
    if (log?.size) {
      const key = `${log.filePath}:${log.fingerprint}`;
      let cached = entries.get(cachePath);
      if (cached?.key !== key) {
        cached = { key, promise: readSongEntry(log) };
        entries.set(cachePath, cached);
      }
      try { logEntry = matchingSongEntry(await cached.promise, title); }
      catch (_) { if (entries.get(cachePath) === cached) entries.delete(cachePath); }
    } else {
      entries.delete(cachePath);
    }
    return { cacheReady, log, logEntry };
  }
  return {
    read,
    loadLyrics: (options) => loadWeSingLyrics(options, readQrc),
    clear() {
      generation += 1;
      entries.clear();
      qrcEntries.clear();
      qrcBytes = 0;
    },
  };
}

async function readSongEntry(latest) {
  if (!latest?.size) return null;
  const minimumStart = Math.floor(Math.max(0, latest.size - MAX_LOG_SCAN_BYTES) / 2) * 2;
  let end = latest.size;
  let pendingRow = '';

  const handle = await fs.promises.open(latest.filePath, 'r');
  try {
    while (end > minimumStart) {
      const start = Math.max(minimumStart, Math.floor(Math.max(0, end - LOG_TAIL_BYTES) / 2) * 2);
      const buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      if (!bytesRead) break;
      const rows = (buffer.subarray(0, bytesRead).toString('utf16le') + pendingRow).split(/\r?\n/);
      // A StartKSong record may straddle two chunks; keep only the unfinished row.
      pendingRow = rows[0].slice(0, LOG_TAIL_BYTES / 2);
      for (const row of rows.reverse()) {
        if (!row.includes('"StartKSong"')) continue;
        const midMatch = row.match(/"mid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        const songMatch = row.match(/"songname"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        const artistMatch = row.match(
          /"(?:artist|artistName|artistname|singer|singerName|singername|歌手|演唱者)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i,
        );
        if (!midMatch) continue;
        const mid = decodeJsonString(midMatch[1]);
        const songName = songMatch ? decodeJsonString(songMatch[1]).trim() : '';
        const artist = artistMatch ? decodeJsonString(artistMatch[1]).trim() : '';
        if (!SAFE_SONG_MID.test(mid)) return null;
        return { mid, songName, ...(artist ? { artist } : {}) };
      }
      end = start;
    }
  } finally {
    await handle.close();
  }
  return null;
}

async function loadWeSingLyrics(options = {}, readQrc = tryReadQrc) {
  const cachePath = normalizeWeSingCachePath(options.cachePath);
  const title = stripWeSingWindowTitle(options.title);
  const resDir = path.join(cachePath, 'WeSingDL', 'Res');
  await assertDirectory(resDir, '全民 K 歌歌词缓存目录不存在。');

  const logEntry = Object.hasOwn(options, 'logEntry')
    ? options.logEntry
    : await findLatestSongEntry(cachePath, title);
  if (logEntry) {
    if (!SAFE_SONG_MID.test(logEntry.mid)) return null;
    const directPath = path.join(resDir, logEntry.mid, `${logEntry.mid}.qrc`);
    const direct = await readQrc(directPath);
    // A known song ID identifies the rendition; another same-title cache is not a substitute.
    return direct ? toLyricResult(direct, logEntry.mid, title) : null;
  }

  const candidates = await listRecentQrcFiles(resDir, Number(options.maxFallbackFiles) || MAX_FALLBACK_FILES);
  const wantedTitle = normalizeTitle(title);
  let matchingResult = null;
  for (const candidate of candidates) {
    const parsed = await readQrc(candidate.filePath);
    if (!parsed) continue;
    if (wantedTitle && normalizeTitle(parsed.title || title) !== wantedTitle) continue;
    if (matchingResult) return null;
    matchingResult = { parsed, songMid: candidate.songMid };
  }
  return matchingResult ? toLyricResult(matchingResult.parsed, matchingResult.songMid, title) : null;
}

async function listRecentQrcFiles(resDir, maximum) {
  const candidates = [];
  for await (const batch of readQrcFileBatches(resDir)) candidates.push(...batch);
  return candidates.sort((a, b) => b.modifiedMs - a.modifiedMs).slice(0, maximum);
}

async function* readQrcFileBatches(resDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(resDir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  const directories = entries.filter((entry) => entry.isDirectory() && SAFE_SONG_MID.test(entry.name));
  for (let start = 0; start < directories.length; start += 100) {
    const batch = directories.slice(start, start + 100);
    const rows = await Promise.all(
      batch.map(async (entry) => {
        const filePath = path.join(resDir, entry.name, `${entry.name}.qrc`);
        try {
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_QRC_BYTES) return null;
          return { filePath, songMid: entry.name, modifiedMs: stat.mtimeMs };
        } catch (_) {
          return null;
        }
      }),
    );
    yield rows.filter(Boolean);
  }
}

async function tryReadQrc(filePath, metadata) {
  try {
    const stat = metadata || await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_QRC_BYTES) return null;
    let payload = await fs.promises.readFile(filePath);
    if (payload.subarray(0, 8).toString('ascii') === '[offset:') {
      const lineEnd = payload.subarray(0, 64).indexOf(0x0a);
      if (lineEnd >= 0) payload = payload.subarray(lineEnd + 1);
    }
    if (!payload.length || payload.length % 8 !== 0) return null;
    return parseQrcDocument(decryptQrc(payload.toString('hex')));
  } catch (_) {
    return null;
  }
}

function parseQrcDocument(qrcXml) {
  const xml = String(qrcXml || '');
  const content = extractQrcLyricContent(xml);
  const lines = parseLyricResult('', '', content, '');
  const title = extractMetadata(content, 'ti');
  const artist = extractMetadata(content, 'ar');
  const lastLineEnd = lines.reduce((maximum, line) => Math.max(maximum, Number(line.endMs) || 0), 0);
  return {
    title,
    artists: artist ? [artist] : [],
    durationMs: lastLineEnd,
    lines,
  };
}

function extractQrcLyricContent(value) {
  const text = String(value || '');
  const marker = 'LyricContent="';
  const start = text.indexOf(marker);
  if (start < 0) return decodeXmlEntities(text);
  const contentStart = start + marker.length;
  const end = text.indexOf('"', contentStart);
  return decodeXmlEntities(end >= 0 ? text.slice(contentStart, end) : text.slice(contentStart));
}

function extractMetadata(content, key) {
  const match = String(content || '').match(new RegExp(`\\[${key}:([^\\]]*)\\]`, 'i'));
  return match ? match[1].trim().slice(0, 120) : '';
}

function toLyricResult(parsed, songMid, fallbackTitle) {
  return {
    songMid,
    title: parsed.title || fallbackTitle,
    artists: [...parsed.artists],
    durationMs: parsed.durationMs,
    lines: structuredClone(parsed.lines),
  };
}

async function assertDirectory(directoryPath, message) {
  if (!(await isDirectory(directoryPath))) throw new Error(message);
}

async function isDirectory(directoryPath) {
  if (!directoryPath) return false;
  try {
    return (await fs.promises.stat(directoryPath)).isDirectory();
  } catch (_) {
    return false;
  }
}

function safeInitialCachePath(value) {
  try {
    return normalizeWeSingCachePath(value);
  } catch (_) {
    return '';
  }
}

function safeInitialLyricOffsetMs(value) {
  try {
    return normalizeWeSingLyricOffsetMs(value);
  } catch (_) {
    return 0;
  }
}

function formatLyricSource(source) {
  if (source === 'qq') return 'QQ 音乐';
  if (source === 'netease') return '网易云音乐';
  return '在线平台';
}

function stripWeSingWindowTitle(value) {
  return String(value || '')
    .replace(/^全民K歌\s*-\s*/, '')
    .trim()
    .slice(0, 120);
}

function normalizeTitle(value) {
  return stripWeSingWindowTitle(value).replace(/\s+/g, '').toLowerCase();
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch (_) {
    return String(value || '');
  }
}

module.exports = {
  createWeSingCacheReader,
  ensureWeSingCacheDirectory,
  hasWeSingCacheData,
  extractQrcLyricContent,
  findLatestSongEntry,
  findLatestWeSingLog,
  formatLyricSource,
  isDirectory,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
  normalizeWeSingLyricOffsetMs,
  parseQrcDocument,
  safeInitialCachePath,
  safeInitialLyricOffsetMs,
  stripWeSingWindowTitle,
};
