'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TRUNCATION_MARKER = '...[truncated]';

function truncateUtf8(value, maxBytes, marker = TRUNCATION_MARKER) {
  const text = String(value ?? '');
  const byteLimit = Math.max(0, Number(maxBytes) || 0);
  if (Buffer.byteLength(text, 'utf8') <= byteLimit) return text;

  const safeMarker = String(marker || '');
  const markerBytes = Buffer.byteLength(safeMarker, 'utf8');
  if (markerBytes >= byteLimit) return sliceUtf8(safeMarker, byteLimit);

  const contentLimit = byteLimit - markerBytes;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= contentLimit) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low > 0 && isHighSurrogate(text.charCodeAt(low - 1))) low -= 1;
  return `${text.slice(0, low)}${safeMarker}`;
}

function appendBoundedFileSync(filePath, line, options = {}) {
  const maxEntryBytes = Math.max(1, Number(options.maxEntryBytes) || 1);
  const maxFileBytes =
    Number(options.maxFileBytes) > 0
      ? Number(options.maxFileBytes)
      : maxEntryBytes;
  const original = String(line ?? '');
  const hasNewline = original.endsWith('\n');
  const newlineBytes = hasNewline ? 1 : 0;
  const content = hasNewline ? original.slice(0, -1) : original;
  const bounded =
    Buffer.byteLength(original, 'utf8') <= maxEntryBytes
      ? original
      : `${truncateUtf8(content, maxEntryBytes - newlineBytes)}${
          hasNewline ? '\n' : ''
        }`;
  const bytes = Buffer.byteLength(bounded, 'utf8');

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    let currentBytes = 0;
    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return { written: false, reason: 'unsafe-target', bytes: 0 };
      }
      currentBytes = stat.size;
    }
    if (currentBytes + bytes > maxFileBytes) {
      return { written: false, reason: 'file-capacity', bytes: 0 };
    }
    fs.appendFileSync(filePath, bounded, 'utf8');
    return { written: true, reason: '', bytes };
  } catch (_) {
    return { written: false, reason: 'write-failed', bytes: 0 };
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
  truncateUtf8,
};
