'use strict';

const { cleanText, cleanTextPreserveLines } = require('../shared/utils');
const { SONG_PRICE_HEADERS } = require('../../public/js/shared/song-import-price-columns.js');
const { SONG_IMPORT_ALIASES } = require('../../public/js/shared/song-import-headers.js');

const SONG_EXPORT_HEADERS = [
  '歌曲名字',
  '歌手',
  '曲风',
  '歌曲标签',
  '是否可点',
  '语言',
  '点歌价格',
  '歌切',
  '核对平台',
  '核对备注',
];

const SONG_TEMPLATE_HEADERS = SONG_EXPORT_HEADERS.map((header) =>
  header === '歌曲标签' ? '歌曲标签（如：怀旧、抒情、治愈）' : header,
);

function normalizeImportedSongRow(row) {
  const priceCells = SONG_PRICE_HEADERS.map((key) => row[key]);
  if (Array.isArray(row.requestPriceColumns)) {
    for (const value of row.requestPriceColumns) {
      if (typeof value !== 'string') throw new Error('点歌价格列必须是文本');
      priceCells.push(value);
    }
  }
  const prices = new Set(priceCells.map((value) => cleanTextPreserveLines(String(value ?? ''))).filter(Boolean));
  if (prices.size > 1) throw new Error('点歌价格别名冲突：请保留一个价格文本');
  return {
    name: cleanText(firstValue(row, SONG_IMPORT_ALIASES.name)),
    artist: cleanText(firstValue(row, SONG_IMPORT_ALIASES.artist)),
    categoryName: cleanText(firstValue(row, SONG_IMPORT_ALIASES.categoryName) || '默认') || '默认',
    tags: cleanText(firstValue(row, SONG_IMPORT_ALIASES.tags)),
    isEnabled: parseEnabled(firstValue(row, SONG_IMPORT_ALIASES.isEnabled), true),
    language: cleanText(firstValue(row, SONG_IMPORT_ALIASES.language)),
    sourcePlatform: cleanText(firstValue(row, SONG_IMPORT_ALIASES.sourcePlatform)),
    note: cleanText(firstValue(row, SONG_IMPORT_ALIASES.note)),
    requestPrice: prices.values().next().value || '',
    songClip: cleanTextPreserveLines(firstValue(row, SONG_IMPORT_ALIASES.songClip)),
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && cleanText(String(row[key] ?? ''))) {
      return row[key];
    }
  }
  return '';
}

function parseEnabled(value, defaultValue) {
  const text = cleanText(String(value ?? '')).toLowerCase();
  if (!text) return defaultValue;
  if (['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(text)) return true;
  if (['否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(text)) return false;
  return defaultValue;
}

module.exports = {
  SONG_EXPORT_HEADERS,
  SONG_TEMPLATE_HEADERS,
  SONG_IMPORT_ALIASES,
  normalizeImportedSongRow,
  firstValue,
  parseEnabled,
};
