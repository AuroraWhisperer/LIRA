'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NO_FOLLOW = fs.constants.O_NOFOLLOW || 0;

const TRUNCATION_MARKER = '...[truncated]';
const NORMAL_LOG_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const ERROR_LOG_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const NORMAL_ENTRY_BYTES = 2 * 1024;
const ERROR_ENTRY_BYTES = 16 * 1024;
const NORMAL_FILE_BYTES = 1024 * 1024;
const ERROR_FILE_MULTIPLIER = 3;
const ERROR_FILE_BYTES = NORMAL_FILE_BYTES * ERROR_FILE_MULTIPLIER;
const RUNTIME_LOG_DIRECTORY = 'runtime';
const ERROR_LOG_DIRECTORY = 'errors';
const maintenanceTimes = new Map();
const LEGACY_TEXT_ERROR = /\[(?:terminal:(?:warn|error)|desktop:[^\]]*(?:warn|warning|error|failed|failure|fatal))\]/i;

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

function boundedEntry(line, maxEntryBytes) {
  const original = String(line ?? '');
  if (Buffer.byteLength(original, 'utf8') <= maxEntryBytes) return original;
  const hasNewline = original.endsWith('\n');
  return hasNewline ? `${truncateUtf8(original.slice(0, -1), maxEntryBytes - 1)}\n` : truncateUtf8(original, maxEntryBytes);
}

function regularLogFiles(filePath) {
  const files = ['', '.1', '.2'].map((suffix) => {
    const file = filePath + suffix;
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { file, stat };
  });
  return files.some(({ stat }) => stat && (!stat.isFile() || stat.isSymbolicLink())) ? null : files;
}

function appendBoundedFileSync(filePath, line, options) {
  const { count, reason, bytes } = appendBoundedLinesSync(filePath, [line], options);
  return { written: count === 1, reason, bytes };
}

function markLogMaintenanceComplete(filePath, now) {
  maintenanceTimes.delete(filePath);
  if (maintenanceTimes.size >= 64) maintenanceTimes.delete(maintenanceTimes.keys().next().value);
  maintenanceTimes.set(filePath, now);
}

function appendBoundedLinesSync(filePath, lines, options = {}) {
  const maxFileBytes = Math.max(1, Math.floor(Number(options.maxFileBytes) || Number(options.maxEntryBytes) || 1));
  const maxEntryBytes = Math.min(maxFileBytes, Math.max(1, Number(options.maxEntryBytes) || 1));
  let count = 0;
  let bytes = 0;
  if (!lines.length) return { count, reason: '', bytes };

  try {
    const now = options.now ?? Date.now();
    const lastMaintenance = maintenanceTimes.get(filePath);
    if (lastMaintenance === undefined || now < lastMaintenance || now - lastMaintenance >= 60 * 60 * 1000) {
      const maintained = maintainBoundedFilesSync(filePath, { ...options, now, maxFileBytes });
      if (!maintained.written) return { count, reason: maintained.reason, bytes };
      markLogMaintenanceComplete(filePath, now);
    }
    const entries = lines.map((line) => Buffer.from(boundedEntry(line, maxEntryBytes)));
    while (count < entries.length) {
      const files = regularLogFiles(filePath);
      if (!files) return { count, reason: 'unsafe-target', bytes };
      let currentBytes = files[0].stat?.size || 0;
      for (const { file, stat } of files) {
        if (stat?.size > maxFileBytes) {
          const trimmedSize = trimFileTailSync(file, maxFileBytes);
          if (file === filePath) currentBytes = trimmedSize;
        }
      }
      if (!files[0].stat) fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (currentBytes + entries[count].length > maxFileBytes) {
        if (files[1].stat) {
          // A same-path rename detects a Windows deny-delete handle before retiring either archive.
          fs.renameSync(filePath, filePath);
          fs.renameSync(files[1].file, files[2].file);
        }
        // A missing .1 may mean the previous rotation already advanced it to .2.
        fs.renameSync(filePath, files[1].file);
        currentBytes = 0;
      }
      let end = count;
      let length = 0;
      while (end < entries.length && currentBytes + length + entries[end].length <= maxFileBytes) {
        length += entries[end].length;
        end += 1;
      }
      const appended = appendFileSegmentSync(filePath, currentBytes, entries.slice(count, end), length);
      count += appended.count;
      bytes += appended.bytes;
      if (count < end) return { count, reason: 'write-failed', bytes };
    }
    return { count, reason: '', bytes };
  } catch {
    return { count, reason: 'write-failed', bytes };
  }
}

// Report only complete entries so the migration can retire exactly that source prefix.
function appendFileSegmentSync(filePath, initialSize, entries, length) {
  const data = entries.length === 1 ? entries[0] : Buffer.concat(entries, length);
  const fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | NO_FOLLOW);
  let offset = 0;
  try {
    while (offset < length) {
      try {
        const written = fs.writeSync(fd, data, offset, length - offset);
        if (!written) break;
        offset += written;
      } catch {
        // Keep the complete prefix and trim any partial UTF-8 entry below.
        break;
      }
    }
    if (offset === length) return { count: entries.length, bytes: length };
    let completeBytes = 0;
    let count = 0;
    while (count < entries.length && completeBytes + entries[count].length <= offset) {
      completeBytes += entries[count].length;
      count += 1;
    }
    if (completeBytes < offset) {
      truncateIncompleteAppendSync(filePath, fd, initialSize + offset, initialSize + completeBytes);
    }
    return { count, bytes: completeBytes };
  } finally {
    fs.closeSync(fd);
  }
}

// Windows append handles cannot truncate. Reopen only the same regular file at the expected size.
function truncateIncompleteAppendSync(filePath, appendFd, expectedSize, completeSize) {
  if (!fs.lstatSync(filePath).isFile()) return;
  const original = fs.fstatSync(appendFd, { bigint: true });
  const fd = fs.openSync(filePath, fs.constants.O_WRONLY | NO_FOLLOW);
  try {
    const current = fs.fstatSync(fd, { bigint: true });
    if (current.dev === original.dev && current.ino === original.ino && current.size === BigInt(expectedSize)) {
      fs.ftruncateSync(fd, completeSize);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function maintainBoundedFilesSync(filePath, options = {}) {
  const now = options.now ?? Date.now();
  const cutoff = now - (options.maxAgeMs || NORMAL_LOG_AGE_MS);
  const normalCutoff = now - NORMAL_LOG_AGE_MS;
  let needsMixedLogPass = false;
  try {
    const files = regularLogFiles(filePath);
    if (!files) return { written: false, reason: 'unsafe-target', bytes: 0 };
    for (const { file, stat } of files) {
      if (!stat) continue;
      if (stat.size > options.maxFileBytes) trimFileTailSync(file, options.maxFileBytes);
      const content = fs.readFileSync(file, 'utf8');
      const kept = content.split(/(?<=\n)/).filter((line) => {
        // A failed legacy extraction must not expire a still-useful error as info.
        const legacyError = LEGACY_TEXT_ERROR.test(line);
        const lineCutoff = legacyError ? Math.min(cutoff, now - ERROR_LOG_AGE_MS) : cutoff;
        const timestamp = logTimestamp(line, stat.mtimeMs);
        const retained = timestamp >= lineCutoff;
        if (retained) needsMixedLogPass ||= legacyError || timestamp < normalCutoff;
        return retained;
      }).join('');
      if (!kept) fs.unlinkSync(file);
      else if (kept !== content) fs.writeFileSync(file, kept, 'utf8');
    }
    return { written: true, reason: '', bytes: 0, needsMixedLogPass };
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
  const descriptor = fs.openSync(filePath, fs.constants.O_RDWR | NO_FOLLOW);
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
    return complete.length;
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
  appendBoundedLinesSync,
  LEGACY_TEXT_ERROR,
  maintainBoundedFilesSync,
  markLogMaintenanceComplete,
  logTimestamp,
  NORMAL_LOG_AGE_MS,
  ERROR_LOG_AGE_MS,
  NORMAL_ENTRY_BYTES,
  ERROR_ENTRY_BYTES,
  NORMAL_FILE_BYTES,
  ERROR_FILE_BYTES,
  ERROR_FILE_MULTIPLIER,
  RUNTIME_LOG_DIRECTORY,
  ERROR_LOG_DIRECTORY,
  truncateUtf8,
};
