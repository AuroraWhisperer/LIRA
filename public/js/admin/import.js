// 编写人：Aurora
// 数据导入导出解析
'use strict';

import { getLegacyAdminModules } from './legacy-admin-bridge.js';
import { parseTable, parseDelimited } from './song-import-parser.js';
import { initCloudSongSync as initializeCloudSongSync } from './cloud-song-sync.js';
import { initCloudSongBackground } from './song-background.js';

(function () {
  const { value, toast, api, showConfirmationDialog } = window.AdminApp.utils;
  async function importSongs() {
    let text = value('importText');
    const file = document.getElementById('importFile').files[0];
    if (file) {
      if (/\.xlsx$/i.test(file.name)) {
        const response = await api('/api/songs/import-xlsx', {
          fileName: file.name,
          base64: await readFileAsBase64(file),
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
      `总行数 ${result.total}，新增 ${result.inserted}，重复跳过 ${result.duplicate}（未更新已有歌曲），失败 ${result.failed}，新增分类 ${result.createdCategories}` +
      (result.failures?.length
        ? `。${result.failures.map((failure) => `数据第 ${failure.row} 行：${failure.reason}`).join('；')}`
        : '');
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
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + chunkSize),
      );
    }
    return btoa(binary);
  }

  function initCloudSongSync() {
    return initializeCloudSongSync({
      getSongs: () => getLegacyAdminModules().state?.getSongs?.() || [],
      toast,
      showConfirmationDialog,
    });
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.imports = {
    importSongs,
    renderImportResult,
    parseTable,
    parseDelimited,
    readTextFile,
    readFileAsBase64,
    initCloudSongSync,
    initCloudSongBackground,
  };
  if (typeof document !== 'undefined') {
    initCloudSongSync();
    initCloudSongBackground();
  }
})();
