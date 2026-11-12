// 编写人：Aurora
// 从 server.js 抽取的纯工具函数，零副作用，不依赖数据库或全局状态。
'use strict';

// ── 文本清洗 ──

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextIntoCharacters(value) {
  const text = String(value || '');
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (item) => item.segment);
  }
  return Array.from(text);
}

function truncateText(value, limit) {
  return splitTextIntoCharacters(value).slice(0, limit).join('');
}

function cleanTextPreserveLines(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
    .trim();
}

// ── 数值标准化 ──

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function normalizeMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeSignedMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

// ── 时间 ──

function normalizeTimestampMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1000000000000) return Math.floor(numeric);
    if (numeric > 1000000000) return Math.floor(numeric * 1000);
  }

  const text = cleanText(value);
  if (!text) return 0;
  const normalizedText = text.includes('T') ? text : `${text.replace(' ', 'T')}+08:00`;
  const timestamp = Date.parse(normalizedText);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function timestampToIso(value) {
  const timestamp = normalizeTimestampMs(value);
  return timestamp ? new Date(timestamp).toISOString() : '';
}

function formatLogTimestamp(value) {
  const timestamp = normalizeTimestampMs(value);
  return timestamp ? new Date(timestamp).toISOString() : '';
}

function now() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── JSON ──

function safeParseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_) {
    return {};
  }
}

// ── 对象/字符串 ──

function readObjectValue(value, keys) {
  if (!value || typeof value !== 'object') return '';
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) {
      return value[key];
    }
  }
  return '';
}

function parseBooleanLike(value) {
  if (value === true || value === 1) return true;
  const text = cleanText(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

// ── 拼音首字母 ──

function getInitial(text) {
  const first = Array.from(cleanText(text))[0];
  if (!first) return '#';
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  if (/^\d$/.test(first)) return '#';

  const pinyinBounds = [
    ['A', '阿'],
    ['B', '八'],
    ['C', '嚓'],
    ['D', '咑'],
    ['E', '妸'],
    ['F', '发'],
    ['G', '旮'],
    ['H', '铪'],
    ['J', '丌'],
    ['K', '咔'],
    ['L', '垃'],
    ['M', '妈'], // 嘸 sorts under F in current ICU and would overwrite F–L initials.
    ['N', '拏'],
    ['O', '噢'],
    ['P', '妑'],
    ['Q', '七'],
    ['R', '呥'],
    ['S', '仨'],
    ['T', '他'],
    ['W', '屲'],
    ['X', '夕'],
    ['Y', '丫'],
    ['Z', '帀'],
  ];
  let result = '#';
  for (const [letter, boundary] of pinyinBounds) {
    if (first.localeCompare(boundary, 'zh-Hans-CN-u-co-pinyin') >= 0) {
      result = letter;
    }
  }
  return result;
}

// ── CSV ──

function csvCell(value) {
  const text = String(value || '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

module.exports = {
  cleanText,
  cleanTextPreserveLines,
  splitTextIntoCharacters,
  truncateText,
  normalizePositiveInteger,
  normalizeMoney,
  normalizeSignedMoney,
  clampPercent,
  normalizeTimestampMs,
  timestampToIso,
  formatLogTimestamp,
  now,
  sleep,
  safeParseJson,
  readObjectValue,
  parseBooleanLike,
  getInitial,
  csvCell,
};
