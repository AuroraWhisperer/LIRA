'use strict';

const aliases = {
  name: ['歌曲名字', '歌曲名称', '歌名', '曲名', 'name', 'songName'],
  artist: ['原唱/首发歌手', '歌手', '演唱者', '原唱', 'artist', 'singer'],
  categoryName: [
    '歌曲分类',
    '类别',
    '分类',
    '分组',
    'category',
    'categoryName',
  ],
  tags: ['歌曲标签', '标签', 'tags', 'tag'],
  isEnabled: ['是否可点', '可点', '是否启用', '启用', 'isEnabled', 'enabled'],
  language: ['语言', '语种', 'language'],
  sourcePlatform: [
    '核对平台',
    '来源平台',
    '平台',
    '来源',
    'sourcePlatform',
    'source',
  ],
  note: ['核对备注', '备注', '说明', 'note'],
  requestPrice: [
    '点歌价格',
    '点歌价',
    '点歌门槛',
    '点歌要求',
    '点歌条件',
    '点歌说明',
    'requestPrice',
    'request_price',
  ],
  songClip: [
    '歌切',
    '歌切链接',
    '歌曲切片',
    '切片链接',
    'songClip',
    'song_clip',
  ],
};

export function parseTable(text, { preserveMissing = false } = {}) {
  const withoutBom = text.replace(/^﻿/, '');
  const clean = preserveMissing ? withoutBom : withoutBom.trim();
  const delimiter = clean.includes('\t') ? '\t' : ',';
  const rows = parseDelimited(clean, delimiter);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim());
  const hasHeader = Object.values(aliases)
    .flat()
    .some((name) => header.includes(name));
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  const indexes = {
    name: hasHeader ? findHeader(header, aliases.name) : 0,
    artist: hasHeader ? findHeader(header, aliases.artist) : 1,
    categoryName: hasHeader ? findHeader(header, aliases.categoryName) : 2,
    tags: hasHeader ? findHeader(header, aliases.tags) : 3,
    isEnabled: hasHeader ? findHeader(header, aliases.isEnabled) : 4,
    language: hasHeader ? findHeader(header, aliases.language) : 5,
    requestPrice: hasHeader ? findHeader(header, aliases.requestPrice) : 6,
    songClip: hasHeader ? findHeader(header, aliases.songClip) : 7,
    sourcePlatform: hasHeader ? findHeader(header, aliases.sourcePlatform) : 8,
    note: hasHeader ? findHeader(header, aliases.note) : 9,
  };

  if (preserveMissing) {
    const columns = hasHeader
      ? header
      : [
          'name',
          'artist',
          'categoryName',
          'tags',
          'isEnabled',
          'language',
          'requestPrice',
          'songClip',
          'sourcePlatform',
          'note',
        ];
    return bodyRows.map((row) => {
      if (!hasHeader && row.length !== columns.length) {
        throw new Error('无表头更新需要完整十列，请使用带表头的模板。');
      }
      return Object.fromEntries(
        columns.map((column, index) => [column, readCell(row, index)]),
      );
    });
  }

  return bodyRows
    .map((row) => {
      // Keep the original price columns for domain-level conflict reporting.
      const priceFields = hasHeader
        ? Object.fromEntries(
            header
              .map((name, index) => [name, readCell(row, index)])
              .filter(([name]) => aliases.requestPrice.includes(name)),
          )
        : {};
      return {
        name: readCell(row, indexes.name),
        artist: readCell(row, indexes.artist),
        categoryName: readCell(row, indexes.categoryName) || '默认',
        tags: readCell(row, indexes.tags),
        isEnabled: parseEnabledCell(readCell(row, indexes.isEnabled)),
        language: readCell(row, indexes.language),
        sourcePlatform: readCell(row, indexes.sourcePlatform),
        note: readCell(row, indexes.note),
        ...priceFields,
        requestPrice:
          priceFields.requestPrice ||
          Object.values(priceFields).find(Boolean) ||
          readCell(row, indexes.requestPrice),
        songClip: readCell(row, indexes.songClip),
      };
    })
    .filter((row) => row.name.trim());
}

export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuote) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuote = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuote = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((item) => item.some(Boolean));
}

function findHeader(header, names) {
  const index = header.findIndex((cell) => names.includes(cell));
  return index >= 0 ? index : -1;
}

function readCell(row, index) {
  return index >= 0 ? (row[index] || '').trim() : '';
}

function parseEnabledCell(val) {
  const text = String(val || '')
    .trim()
    .toLowerCase();
  if (!text) return true;
  if (['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(text))
    return true;
  if (['否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(text))
    return false;
  return true;
}
