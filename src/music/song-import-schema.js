'use strict';

const { cleanText } = require('../shared/utils');

const SONG_EXPORT_HEADERS = [
  '歌曲名字',
  '原唱/首发歌手',
  '歌曲分类',
  '歌曲标签',
  '是否可点',
  '语言',
  '核对平台',
  '核对备注'
];

const SONG_IMPORT_ALIASES = {
  name: ['name', 'songName', '歌曲名字', '歌曲名称', '歌名', '曲名'],
  artist: ['artist', 'singer', '原唱/首发歌手', '歌手', '演唱者', '原唱'],
  categoryName: ['categoryName', 'category', '歌曲分类', '类别', '分类', '分组'],
  note: ['note', '核对备注', '备注', '说明'],
  tags: ['tags', 'tag', '歌曲标签', '标签'],
  isEnabled: ['isEnabled', 'enabled', '是否可点', '可点', '是否启用', '启用'],
  language: ['language', '语言', '语种'],
  sourcePlatform: ['sourcePlatform', 'source', '核对平台', '来源平台', '平台', '来源']
};

function normalizeImportedSongRow(row) {
  return {
    name: cleanText(firstValue(row, SONG_IMPORT_ALIASES.name)),
    artist: cleanText(firstValue(row, SONG_IMPORT_ALIASES.artist)),
    categoryName: cleanText(firstValue(row, SONG_IMPORT_ALIASES.categoryName) || '默认') || '默认',
    tags: cleanText(firstValue(row, SONG_IMPORT_ALIASES.tags)),
    isEnabled: parseEnabled(firstValue(row, SONG_IMPORT_ALIASES.isEnabled), true),
    language: cleanText(firstValue(row, SONG_IMPORT_ALIASES.language)),
    sourcePlatform: cleanText(firstValue(row, SONG_IMPORT_ALIASES.sourcePlatform)),
    note: cleanText(firstValue(row, SONG_IMPORT_ALIASES.note))
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && cleanText(row[key])) {
      return row[key];
    }
  }
  return '';
}

function parseEnabled(value, defaultValue) {
  const text = cleanText(value).toLowerCase();
  if (!text) return defaultValue;
  if (['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(text)) return true;
  if (['否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(text)) return false;
  return defaultValue;
}

module.exports = {
  SONG_EXPORT_HEADERS,
  SONG_IMPORT_ALIASES,
  normalizeImportedSongRow,
  firstValue,
  parseEnabled
};
