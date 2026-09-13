'use strict';

import { api } from '../shared/utils.js';
import { parseTable } from './song-import-parser.js';

const PAGE_SIZE = 25;
const FIELD_LABELS = {
  name: '歌名',
  artist: '歌手',
  categoryName: '分类',
  tags: '标签',
  isEnabled: '是否可点',
  language: '语言',
  requestPrice: '点歌价格',
  songClip: '歌切',
  sourcePlatform: '核对平台',
  note: '备注',
};
const STATUS_LABELS = {
  inserted: '新增',
  updated: '更新',
  unchanged: '未改变',
  conflict: '冲突',
  invalid: '无效',
};
const ERROR_MESSAGES = {
  SONG_IMPORT_PREVIEW_STALE: '歌库或导入内容已变化，请重新预览。',
  SONG_IMPORT_PREVIEW_INVALID:
    '请修正冲突或无效行后重新预览；没有变更时无需应用。',
  SONG_IMPORT_INPUT_INVALID:
    '无法读取更新内容，请使用完整模板或带表头的文件（最多 5000 行）。',
  SONG_IMPORT_FAILED: '导入未完成，已回滚，请重试。',
};

export function initSongImportUpdate({
  imports,
  reloadSongs,
  request = api,
  documentRef = document,
}) {
  const mode = documentRef.getElementById('songImportMode');
  if (!mode) return;
  const textInput = documentRef.getElementById('importText');
  const fileInput = documentRef.getElementById('importFile');
  const clearInput = documentRef.getElementById('songImportAllowEmptyClear');
  const options = documentRef.getElementById('songImportUpdateOptions');
  const previewButton = documentRef.getElementById('songImportPreviewBtn');
  const applyButton = documentRef.getElementById('songImportApplyBtn');
  const panel = documentRef.getElementById('songImportPreview');
  const summary = documentRef.getElementById('songImportPreviewSummary');
  const table = documentRef.getElementById('songImportPreviewRows');
  const result = documentRef.getElementById('importResult');
  const previous = documentRef.getElementById('songImportPreviousPage');
  const next = documentRef.getElementById('songImportNextPage');
  const pageLabel = documentRef.getElementById('songImportPage');
  let generation = 0;
  let busy = false;
  let preview = null;
  let page = 0;

  function refreshButtons() {
    const updating = mode.value === 'update';
    options.hidden = !updating;
    documentRef.getElementById('importBtn').hidden = updating;
    previewButton.disabled = busy;
    applyButton.disabled = busy || !preview?.data.canApply;
  }

  function invalidate() {
    generation += 1;
    preview = null;
    panel.hidden = true;
    table.replaceChildren();
    result.textContent = '';
    refreshButtons();
  }

  function displayValue(value) {
    if (value === null) return '（新增）';
    if (value === '') return '（空）';
    if (typeof value === 'boolean') return value ? '是' : '否';
    return String(value);
  }

  function renderPage() {
    if (!preview) return;
    table.replaceChildren();
    const rows = preview.data.rows;
    for (const row of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const tr = documentRef.createElement('tr');
      const changes = row.differences
        .map(
          (diff) =>
            `${FIELD_LABELS[diff.field] || diff.field}：${displayValue(diff.before)} → ${displayValue(diff.after)}`,
        )
        .join('\n');
      for (const value of [
        row.row,
        `${row.name || '（无歌名）'} / ${row.artist || '（无歌手）'}`,
        STATUS_LABELS[row.status],
        changes,
        row.reason || '',
      ]) {
        const td = documentRef.createElement('td');
        td.textContent = String(value);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    pageLabel.textContent = `第 ${page + 1} / ${pages} 页，每页最多 ${PAGE_SIZE} 行`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pages;
  }

  async function readInput() {
    const file = fileInput.files[0];
    const allowEmptyClear = clearInput.checked;
    if (file && /\.xlsx$/i.test(file.name)) {
      return { base64: await imports.readFileAsBase64(file), allowEmptyClear };
    }
    const text = file ? await imports.readTextFile(file) : textInput.value;
    return {
      rows: parseTable(text, { preserveMissing: true }),
      allowEmptyClear,
    };
  }

  function showFailure(error) {
    result.textContent =
      ERROR_MESSAGES[error?.code || error?.message] ||
      error?.message ||
      '导入失败，请重新预览。';
  }

  previewButton.addEventListener('click', async () => {
    if (busy) return;
    invalidate();
    const current = generation;
    busy = true;
    refreshButtons();
    result.textContent = '正在生成预览…';
    try {
      const payload = await readInput();
      if (current !== generation) return;
      const response = await request('/api/songs/import-preview', payload);
      if (current !== generation) return;
      preview = { payload, data: response.data };
      page = 0;
      summary.textContent = Object.entries(response.data.counts)
        .map(([key, count]) => `${STATUS_LABELS[key]} ${count}`)
        .join('，');
      panel.hidden = false;
      renderPage();
      result.textContent = response.data.canApply
        ? '请检查差异，确认后应用；不会删除未列出的歌曲。'
        : '没有可应用的变更，或存在冲突/无效行；请修正后重新预览。';
    } catch (error) {
      if (current === generation) showFailure(error);
    } finally {
      busy = false;
      refreshButtons();
    }
  });

  applyButton.addEventListener('click', async () => {
    if (busy || !preview?.data.canApply) return;
    const submitted = preview;
    const current = generation;
    preview = null;
    busy = true;
    refreshButtons();
    result.textContent = '正在应用预览…';
    try {
      const response = await request('/api/songs/import-apply', {
        ...submitted.payload,
        previewToken: submitted.data.previewToken,
      });
      if (current === generation) {
        panel.hidden = true;
        table.replaceChildren();
        const counts = response.data;
        result.textContent = `本地已新增 ${counts.inserted}、更新 ${counts.updated}、未改变 ${counts.unchanged} 首；网页更新以云端同步结果为准。`;
      }
      try {
        await reloadSongs();
      } catch (error) {
        if (current === generation)
          result.textContent += ' 本地已保存，但列表刷新失败，请刷新页面。';
      }
    } catch (error) {
      if (current === generation) {
        panel.hidden = true;
        table.replaceChildren();
        showFailure(error);
      }
    } finally {
      busy = false;
      refreshButtons();
    }
  });

  mode.addEventListener('change', invalidate);
  textInput.addEventListener('input', invalidate);
  fileInput.addEventListener('change', invalidate);
  clearInput.addEventListener('change', invalidate);
  previous.addEventListener('click', () => {
    if (preview && page > 0) {
      page -= 1;
      renderPage();
    }
  });
  next.addEventListener('click', () => {
    if (preview && (page + 1) * PAGE_SIZE < preview.data.rows.length) {
      page += 1;
      renderPage();
    }
  });
  refreshButtons();
}
