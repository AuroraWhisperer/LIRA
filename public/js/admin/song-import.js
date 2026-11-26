// 编写人：Aurora
// 数据导入导出解析
'use strict';

import * as sharedUtils from '../shared/utils.js';
import { parseTable, parseDelimited } from './song-import-parser.js';
import { initCloudSongSync as initializeCloudSongSync } from './cloud-song-sync.js';
import { initCloudSongBackground } from './song-background.js';

export function createSongImports({ utils = sharedUtils } = {}) {
  const { toast, showConfirmationDialog } = utils;
  async function readTextFile(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      try { return new TextDecoder('gb18030').decode(bytes); }
      catch { return new TextDecoder('utf-8').decode(bytes); }
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

  function initCloudSongSync() {
    return initializeCloudSongSync({
      toast,
      showConfirmationDialog,
    });
  }

  return {
    parseTable,
    parseDelimited,
    readTextFile,
    readFileAsBase64,
    initCloudSongSync,
    initCloudSongBackground,
  };
}

export const songImports = createSongImports();
if (typeof document !== 'undefined') {
  songImports.initCloudSongSync();
  songImports.initCloudSongBackground();
}
