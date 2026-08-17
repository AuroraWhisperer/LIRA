'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { decryptQrc } = require('qrc-decoder');
const { parseLyricResult } = require('./lyrics');

const LOG_TAIL_BYTES = 100 * 1024;
const MAX_QRC_BYTES = 4 * 1024 * 1024;
const MAX_FALLBACK_FILES = 80;
const MIN_LYRIC_OFFSET_MS = -3000;
const MAX_LYRIC_OFFSET_MS = 3000;
const SAFE_SONG_MID = /^[a-zA-Z0-9_-]{1,128}$/;

function normalizeWeSingCachePath(input) {
  const value = String(input || '').trim().replace(/^"|"$/g, '');
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
  await fs.promises.mkdir(cachePath, { recursive: true });
  return cachePath;
}

async function findLatestSongEntry(cachePath, expectedTitle = '') {
  const basePath = normalizeWeSingCachePath(cachePath);
  const logDir = path.join(basePath, 'Log', 'WeSing');
  let entries;
  try {
    entries = await fs.promises.readdir(logDir, { withFileTypes: true });
  } catch (_) {
    return null;
  }

  const logFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue;
    const filePath = path.join(logDir, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      logFiles.push({ filePath, modifiedMs: stat.mtimeMs, size: stat.size });
    } catch (_) {}
  }
  logFiles.sort((a, b) => b.modifiedMs - a.modifiedMs);
  if (!logFiles.length) return null;

  const latest = logFiles[0];
  const start = Math.max(0, latest.size - LOG_TAIL_BYTES) & ~1;
  const length = Math.max(0, latest.size - start);
  if (!length) return null;

  const handle = await fs.promises.open(latest.filePath, 'r');
  let buffer;
  try {
    buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, start);
    buffer = buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }

  const wantedTitle = normalizeTitle(expectedTitle);
  const rows = buffer.toString('utf16le').split(/\r?\n/).reverse();
  for (const row of rows) {
    if (!row.includes('"StartKSong"')) continue;
    const midMatch = row.match(/"mid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    const songMatch = row.match(/"songname"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (!midMatch) continue;
    const mid = decodeJsonString(midMatch[1]);
    const songName = songMatch ? decodeJsonString(songMatch[1]).trim() : '';
    if (!SAFE_SONG_MID.test(mid)) return null;
    if (wantedTitle && normalizeTitle(songName) !== wantedTitle) continue;
    return { mid, songName };
  }
  return null;
}

async function loadWeSingLyrics(options = {}) {
  const cachePath = normalizeWeSingCachePath(options.cachePath);
  const title = stripWeSingWindowTitle(options.title);
  const resDir = path.join(cachePath, 'WeSingDL', 'Res');
  await assertDirectory(resDir, '全民 K 歌歌词缓存目录不存在。');

  const logEntry = await findLatestSongEntry(cachePath, title);
  if (logEntry) {
    const directPath = path.join(resDir, logEntry.mid, `${logEntry.mid}.qrc`);
    const direct = await tryReadQrc(directPath);
    if (direct) return toLyricResult(direct, logEntry.mid, title);
  }

  const candidates = await listRecentQrcFiles(
    resDir,
    Number(options.maxFallbackFiles) || MAX_FALLBACK_FILES
  );
  const wantedTitle = normalizeTitle(title);
  for (const candidate of candidates) {
    const parsed = await tryReadQrc(candidate.filePath);
    if (!parsed) continue;
    const result = toLyricResult(parsed, candidate.songMid, title);
    if (!wantedTitle || normalizeTitle(result.title) === wantedTitle) return result;
  }
  return null;
}

async function listRecentQrcFiles(resDir, maximum) {
  let entries;
  try {
    entries = await fs.promises.readdir(resDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const candidates = [];
  const directories = entries.filter((entry) => entry.isDirectory() && SAFE_SONG_MID.test(entry.name));
  for (let start = 0; start < directories.length; start += 100) {
    const batch = directories.slice(start, start + 100);
    const rows = await Promise.all(batch.map(async (entry) => {
      const filePath = path.join(resDir, entry.name, `${entry.name}.qrc`);
      try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_QRC_BYTES) return null;
        return { filePath, songMid: entry.name, modifiedMs: stat.mtimeMs };
      } catch (_) {
        return null;
      }
    }));
    candidates.push(...rows.filter(Boolean));
  }
  return candidates.sort((a, b) => b.modifiedMs - a.modifiedMs).slice(0, maximum);
}

async function tryReadQrc(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
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
  const saveTime = Number((xml.match(/\bSaveTime="(\d+)"/i) || [])[1]);
  const lastLineEnd = lines.reduce((maximum, line) => Math.max(maximum, Number(line.endMs) || 0), 0);
  return {
    title,
    artists: artist ? [artist] : [],
    durationMs: saveTime > 0 ? saveTime * 1000 : lastLineEnd,
    lines
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
    artists: parsed.artists,
    durationMs: parsed.durationMs,
    lines: parsed.lines
  };
}

async function assertDirectory(directoryPath, message) {
  if (!await isDirectory(directoryPath)) throw new Error(message);
}

async function isDirectory(directoryPath) {
  if (!directoryPath) return false;
  try { return (await fs.promises.stat(directoryPath)).isDirectory(); } catch (_) { return false; }
}

function safeInitialCachePath(value) {
  try { return normalizeWeSingCachePath(value); } catch (_) { return ''; }
}

function safeInitialLyricOffsetMs(value) {
  try { return normalizeWeSingLyricOffsetMs(value); } catch (_) { return 0; }
}

function formatLyricSource(source) {
  if (source === 'qq') return 'QQ 音乐';
  if (source === 'netease') return '网易云音乐';
  return '在线平台';
}

function stripWeSingWindowTitle(value) {
  return String(value || '').replace(/^全民K歌\s*-\s*/, '').trim().slice(0, 120);
}

function normalizeTitle(value) {
  return stripWeSingWindowTitle(value).replace(/\s+/g, '').toLowerCase();
}

function decodeJsonString(value) {
  try { return JSON.parse(`"${value}"`); } catch (_) { return String(value || ''); }
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

module.exports = {
  ensureWeSingCacheDirectory,
  extractQrcLyricContent,
  findLatestSongEntry,
  formatLyricSource,
  isDirectory,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
  normalizeWeSingLyricOffsetMs,
  parseQrcDocument,
  safeInitialCachePath,
  safeInitialLyricOffsetMs,
  stripWeSingWindowTitle
};
