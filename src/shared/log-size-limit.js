'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TRUNCATION_MARKER = '...[truncated]';
const NORMAL_LOG_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const ERROR_LOG_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const maintenanceTimes = new Map();

function truncateUtf8(value, maxBytes, marker = TRUNCATION_MARKER) {
  const text = String(value ?? '');
  const byteLimit = Math.max(0, Number(maxBytes) || 0);
  if (Buffer.byteLength(text, 'utf8') <= byteLimit) return text;

  const safeMarker = String(marker || '');
  const markerBytes = Buffer.byteLength(safeMarker, 'utf8');
  if (markerBytes >= byteLimit) return sliceUtf8(safeMarker, byteLimit);

  const contentLimit = byteLimit - markerBytes;
  return `${sliceUtf8(text, contentLimit)}${safeMarker}`;
}

function appendBoundedFileSync(filePath, line, options = {}) {
  const maxFileBytes = Math.max(1, Math.floor(Number(options.maxFileBytes) || Number(options.maxEntryBytes) || 1));
  const maxEntryBytes = Math.min(maxFileBytes, Math.max(1, Number(options.maxEntryBytes) || 1));
  const original = String(line ?? '');
  const hasNewline = original.endsWith('\n');
  const newlineBytes = hasNewline ? 1 : 0;
  const content = hasNewline ? original.slice(0, -1) : original;
  const bounded =
    Buffer.byteLength(original, 'utf8') <= maxEntryBytes
      ? original
      : `${truncateUtf8(content, maxEntryBytes - newlineBytes)}${hasNewline ? '\n' : ''}`;
  const bytes = Buffer.byteLength(bounded, 'utf8');

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const now = options.now ?? Date.now();
    const lastMaintenance = maintenanceTimes.get(filePath);
    if (lastMaintenance === undefined || now < lastMaintenance || now - lastMaintenance >= 60 * 60 * 1000) {
      const maintained = maintainBoundedFilesSync(filePath, { ...options, now, maxFileBytes });
      if (!maintained.written) return maintained;
      if (maintenanceTimes.size >= 64) maintenanceTimes.delete(maintenanceTimes.keys().next().value);
      maintenanceTimes.set(filePath, now);
    }
    const files = [filePath, `${filePath}.1`, `${filePath}.2`];
    const sizes = files.map((file) => {
      try { return fs.lstatSync(file); } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    });
    for (const stat of sizes) {
      if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
        return { written: false, reason: 'unsafe-target', bytes: 0 };
      }
    }
    for (let index = 0; index < files.length; index += 1) {
      if (sizes[index]?.size > maxFileBytes) trimFileTailSync(files[index], maxFileBytes);
    }
    const currentBytes = sizes[0] ? fs.statSync(filePath).size : 0;
    if (currentBytes + bytes > maxFileBytes) {
      if (sizes[2]) fs.unlinkSync(files[2]);
      if (sizes[1]) fs.renameSync(files[1], files[2]);
      if (sizes[0]) fs.renameSync(files[0], files[1]);
    }
    fs.appendFileSync(filePath, bounded, 'utf8');
    return { written: true, reason: '', bytes };
  } catch (_) {
    return { written: false, reason: 'write-failed', bytes: 0 };
  }
}

function maintainBoundedFilesSync(filePath, options = {}) {
  const now = options.now ?? Date.now();
  const cutoff = now - (options.maxAgeMs || NORMAL_LOG_AGE_MS);
  try {
    const files = ['', '.1', '.2'].map((suffix) => {
      try { return { file: filePath + suffix, stat: fs.lstatSync(filePath + suffix) }; } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }).filter(Boolean);
    if (files.some(({ stat }) => !stat.isFile() || stat.isSymbolicLink())) {
      return { written: false, reason: 'unsafe-target', bytes: 0 };
    }
    for (const { file, stat } of files) {
      if (stat.size > options.maxFileBytes) trimFileTailSync(file, options.maxFileBytes);
      const content = fs.readFileSync(file, 'utf8');
      const kept = content.split(/(?<=\n)/).filter((line) => {
        // A failed legacy extraction must not expire a still-useful error as info.
        const legacyError = /\[(?:terminal:(?:warn|error)|desktop:[^\]]*(?:warn|warning|error|failed|failure|fatal))\]/i.test(line);
        const lineCutoff = legacyError ? Math.min(cutoff, now - ERROR_LOG_AGE_MS) : cutoff;
        return logTimestamp(line, stat.mtimeMs) >= lineCutoff;
      }).join('');
      if (!kept) fs.unlinkSync(file);
      else if (kept !== content) fs.writeFileSync(file, kept, 'utf8');
    }
    return { written: true, reason: '', bytes: 0 };
  } catch { return { written: false, reason: 'write-failed', bytes: 0 }; }
}

function logTimestamp(line, fallback) {
  const match = line.match(/^\[([^\]]+)\]/);
  let value = match?.[1];
  if (!value && line.startsWith('{')) {
    try { const record = JSON.parse(line); value = record.timestamp || record.time; } catch { return fallback; }
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Only the newest complete lines of an oversized legacy file are retained.
function trimFileTailSync(filePath, maxBytes) {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0));
  try {
    const size = fs.fstatSync(descriptor).size;
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const start = Math.max(0, size - maxBytes);
    const read = fs.readSync(descriptor, buffer, 0, buffer.length, start);
    const tail = buffer.subarray(0, read);
    const newline = start > 0 ? tail.indexOf(10) : -1;
    const complete = start > 0 ? tail.subarray(newline < 0 ? tail.length : newline + 1) : tail;
    fs.writeSync(descriptor, complete, 0, complete.length, 0);
    fs.ftruncateSync(descriptor, complete.length);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sliceUtf8(value, maxBytes) {
  const text = String(value || '');
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low > 0 && isHighSurrogate(text.charCodeAt(low - 1))) low -= 1;
  return text.slice(0, low);
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

module.exports = {
  TRUNCATION_MARKER,
  appendBoundedFileSync,
  maintainBoundedFilesSync,
  logTimestamp,
  NORMAL_LOG_AGE_MS,
  ERROR_LOG_AGE_MS,
  truncateUtf8,
};
