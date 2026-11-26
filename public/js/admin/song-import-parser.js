'use strict';

import { repeatedPriceIndexes } from '../shared/song-import-price-columns.js';
import { SONG_IMPORT_ALIASES as aliases, hasSongImportHeader } from '../shared/song-import-headers.js';

export function parseTable(text, { preserveMissing = false, delimiter } = {}) {
  const withoutBom = text.replace(/^﻿/, '');
  const clean = preserveMissing ? withoutBom : withoutBom.trim();
  const rows = parseDelimited(clean, delimiter ?? detectDelimiter(clean));
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim());
  const hasHeader = hasSongImportHeader(header, rows);
  const bodyRows = hasHeader ? rows.slice(1) : rows;
  const repeatedPrices = hasHeader ? repeatedPriceIndexes(header) : [];

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
      const fields = Object.fromEntries(columns.map((column, index) => [column, readCell(row, index)]));
      if (repeatedPrices.length) fields.requestPriceColumns = repeatedPrices.map((index) => readCell(row, index));
      return fields;
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
          priceFields.requestPrice || Object.values(priceFields).find(Boolean) || readCell(row, indexes.requestPrice),
        ...(repeatedPrices.length && { requestPriceColumns: repeatedPrices.map((index) => readCell(row, index)) }),
        songClip: readCell(row, indexes.songClip),
      };
    })
    .filter((row) => row.name.trim());
}

function detectDelimiter(text) {
  let inQuote = false;
  let hasContent = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuote && text[i + 1] === '"') i += 1;
      else inQuote = !inQuote;
    } else if (!inQuote && char === '\t') {
      return '\t';
    } else if (!inQuote && (char === '\n' || char === '\r') && hasContent) {
      break;
    }
    if (/\S/.test(char)) hasContent = true;
  }
  return ',';
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
    } else if (char === '\n' || char === '\r') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') i += 1;
    } else {
      cell += char;
    }
  }
  if (inQuote) throw new Error('表格中的双引号未闭合，请检查文件是否完整，修正后重新检查歌单。');
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
  if (['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(text)) return true;
  if (['否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(text)) return false;
  return true;
}
