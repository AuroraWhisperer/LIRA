// 编写人：Aurora
// 数据导入导出解析
'use strict';

(function () {
  const { value, toast, showError, api } = window.AdminApp.utils;

  async function importSongs() {
    let text = value('importText');
    const file = document.getElementById('importFile').files[0];
    if (file) {
      if (/\.xlsx$/i.test(file.name)) {
        const response = await api('/api/songs/import-xlsx', {
          fileName: file.name,
          base64: await readFileAsBase64(file)
        });
        renderImportResult(response.data);
        toast('Excel 导入完成');
        if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
          await window.AdminApp.state.reloadAll();
        }
        return;
      }
      text = await readTextFile(file);
    }
    if (!text.trim()) {
      toast('没有可导入内容');
      return;
    }

    const rows = parseTable(text);
    const response = await api('/api/songs/import', { rows });
    renderImportResult(response.data);
    toast('导入完成');
    if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
      await window.AdminApp.state.reloadAll();
    }
  }

  function renderImportResult(result) {
    document.getElementById('importResult').textContent =
      `总行数 ${result.total}，成功 ${result.inserted}，重复 ${result.duplicate}，失败 ${result.failed}，新增分类 ${result.createdCategories}`;
  }

  function parseTable(text) {
    const clean = text.replace(/^﻿/, '').trim();
    const delimiter = clean.includes('\t') ? '\t' : ',';
    const rows = parseDelimited(clean, delimiter);
    if (rows.length === 0) return [];

    const header = rows[0].map((cell) => cell.trim());
    const aliases = {
      name: ['歌曲名字', '歌曲名称', '歌名', '曲名', 'name', 'songName'],
      artist: ['歌手', '演唱者', '原唱', 'artist', 'singer'],
      categoryName: ['歌曲分类', '类别', '分类', '分组', 'category', 'categoryName'],
      note: ['备注', '说明', 'note'],
      tags: ['标签', '歌曲标签', 'tags', 'tag'],
      isEnabled: ['是否可点', '可点', '是否启用', '启用', 'isEnabled', 'enabled'],
      language: ['语言', '语种', 'language'],
      sourcePlatform: ['来源平台', '平台', '来源', 'sourcePlatform', 'source'],
      originalGroup: ['原始分组', '原分组', '原分类', 'originalGroup']
    };
    const hasHeader = Object.values(aliases).flat().some((name) => header.includes(name));
    const bodyRows = hasHeader ? rows.slice(1) : rows;

    const indexes = {
      name: hasHeader ? findHeader(header, aliases.name) : 0,
      artist: hasHeader ? findHeader(header, aliases.artist) : 1,
      categoryName: hasHeader ? findHeader(header, aliases.categoryName) : 2,
      note: hasHeader ? findHeader(header, aliases.note) : 3,
      tags: hasHeader ? findHeader(header, aliases.tags) : 4,
      isEnabled: hasHeader ? findHeader(header, aliases.isEnabled) : 5,
      language: hasHeader ? findHeader(header, aliases.language) : 6,
      sourcePlatform: hasHeader ? findHeader(header, aliases.sourcePlatform) : 7,
      originalGroup: hasHeader ? findHeader(header, aliases.originalGroup) : 8
    };

    return bodyRows.map((row) => ({
      name: readCell(row, indexes.name),
      artist: readCell(row, indexes.artist),
      categoryName: readCell(row, indexes.categoryName) || '默认',
      note: readCell(row, indexes.note),
      tags: readCell(row, indexes.tags),
      isEnabled: parseEnabledCell(readCell(row, indexes.isEnabled)),
      language: readCell(row, indexes.language),
      sourcePlatform: readCell(row, indexes.sourcePlatform),
      originalGroup: readCell(row, indexes.originalGroup)
    })).filter((row) => row.name.trim());
  }

  function parseDelimited(text, delimiter) {
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
    const text = String(val || '').trim().toLowerCase();
    if (!text) return true;
    if (['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(text)) return true;
    if (['否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(text)) return false;
    return true;
  }

  async function readTextFile(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (!utf8Text.includes('�')) return utf8Text;
    try {
      return new TextDecoder('gb18030', { fatal: false }).decode(bytes);
    } catch (_) {
      return utf8Text;
    }
  }

  async function readFileAsBase64(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.imports = {
    importSongs,
    renderImportResult,
    parseTable,
    parseDelimited,
    readTextFile,
    readFileAsBase64
  };
})();
