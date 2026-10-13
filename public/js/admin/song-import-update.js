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
  deleted: '删除',
};
const ERROR_MESSAGES = {
  SONG_IMPORT_PREVIEW_STALE: '歌库或导入内容已变化，请重新预览。',
  SONG_IMPORT_PREVIEW_INVALID: '请修正冲突或无效行后重新预览；没有变更时无需应用。',
  SONG_IMPORT_INPUT_INVALID: '无法读取更新内容，请使用完整模板或带表头的文件（最多 5000 行）。',
  SONG_IMPORT_FAILED: '导入未完成，已回滚，请重试。',
};

export function initSongImportUpdate({ imports, reloadSongs, request = api, documentRef = document }) {
  const previewButton = documentRef.getElementById('songImportPreviewBtn');
  if (!previewButton) return;
  const textInput = documentRef.getElementById('importText');
  const fileInput = documentRef.getElementById('importFile');
  const sourceLabel = documentRef.getElementById('songImportSource');
  const applyButton = documentRef.getElementById('songImportApplyBtn');
  const panel = documentRef.getElementById('songImportPreview');
  const title = documentRef.getElementById('songImportPreviewTitle');
  const summary = documentRef.getElementById('songImportPreviewSummary');
  const guidance = documentRef.getElementById('songImportPreviewGuidance');
  const details = documentRef.getElementById('songImportDetails');
  const detailsLabel = documentRef.getElementById('songImportDetailsLabel');
  const table = documentRef.getElementById('songImportPreviewRows');
  const tableScroll = documentRef.getElementById('songImportTable');
  const result = documentRef.getElementById('importResult');
  const previous = documentRef.getElementById('songImportPreviousPage');
  const next = documentRef.getElementById('songImportNextPage');
  const pageLabel = documentRef.getElementById('songImportPage');
  let generation = 0;
  let busy = false;
  let preview = null;
  let page = 0;

  function refreshButtons() {
    previewButton.disabled = busy;
    previewButton.textContent = preview ? '重新检查歌单' : '下一步：检查歌单';
    previewButton.classList.toggle('primary', !preview);
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
      for (const value of [
        row.row ?? '—',
        `${row.name || '（无歌名）'} / ${row.artist || '（无歌手）'}`,
        STATUS_LABELS[row.status],
      ]) {
        const td = documentRef.createElement('td');
        td.textContent = String(value);
        tr.appendChild(td);
      }
      const changesCell = documentRef.createElement('td');
      if (row.differences.length) {
        const changes = documentRef.createElement('details');
        const label = documentRef.createElement('summary');
        label.textContent = row.status === 'inserted' ? '查看歌曲信息' : `查看 ${row.differences.length} 项变更`;
        const content = documentRef.createElement('div');
        content.className = 'song-import-differences';
        content.textContent = row.differences
          .map((diff) => row.status === 'inserted'
            ? `${FIELD_LABELS[diff.field] || diff.field}：${displayValue(diff.after)}`
            : `${FIELD_LABELS[diff.field] || diff.field}：${displayValue(diff.before)} → ${displayValue(diff.after)}`)
          .join('\n');
        changes.appendChild(label);
        changes.appendChild(content);
        changesCell.appendChild(changes);
      } else {
        changesCell.textContent = '—';
      }
      tr.appendChild(changesCell);
      const reason = documentRef.createElement('td');
      reason.textContent = row.reason || '';
      tr.appendChild(reason);
      table.appendChild(tr);
    }
    tableScroll.scrollTop = 0;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    pageLabel.textContent = `第 ${page + 1} / ${pages} 页，每页最多 ${PAGE_SIZE} 行`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pages;
  }

  async function readInput() {
    const file = fileInput.files[0];
    if (file && /\.xlsx$/i.test(file.name)) {
      return { base64: await imports.readFileAsBase64(file), replaceAll: true };
    }
    const text = file ? await imports.readTextFile(file) : textInput.value;
    return {
      rows: parseTable(text, { preserveMissing: true }),
      replaceAll: true,
    };
  }

  function showFailure(error) {
    result.textContent = ERROR_MESSAGES[error?.code || error?.message] || error?.message || '导入失败，请重新预览。';
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
      sourceLabel.textContent = fileInput.files[0] ? `本次来源：文件 ${fileInput.files[0].name}` : '本次来源：粘贴的表格';
      page = 0;
      const { counts, canApply, rows } = response.data;
      const hasErrors = counts.conflict > 0 || counts.invalid > 0;
      summary.textContent = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${STATUS_LABELS[key]} ${count}`)
        .join('，') || '没有可导入的歌曲';
      title.textContent = canApply ? '检查完成，尚未导入' : hasErrors ? '请先修正表格' : '无需导入';
      guidance.textContent = canApply
        ? `确认后将以新表格替换整个歌库，删除 ${counts.deleted} 首未列出的旧歌曲；已有点歌记录保留。请核对上方数量，再点击「确认替换歌库」。`
        : hasErrors
          ? '尚未导入。请查看明细中的说明，修正冲突或无效行后重新检查。'
          : '歌库没有可应用的变更，原歌库保持不变。';
      details.open = hasErrors;
      detailsLabel.textContent = `查看逐行明细（${rows.length} 项）`;
      panel.hidden = false;
      renderPage();
      result.textContent = '';
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'start' });
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
    result.textContent = '正在替换歌库…';
    try {
      const response = await request('/api/songs/import-apply', {
        ...submitted.payload,
        previewToken: submitted.data.previewToken,
      });
      if (current === generation) {
        panel.hidden = true;
        table.replaceChildren();
        const counts = response.data;
        result.textContent = `本地歌库已替换：新增 ${counts.inserted}、更新 ${counts.updated}、删除 ${counts.deleted}、未改变 ${counts.unchanged} 首；网页更新以云端同步结果为准。`;
      }
      try {
        await reloadSongs();
      } catch (error) {
        if (current === generation) result.textContent += ' 本地已保存，但列表刷新失败，请刷新页面。';
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

  textInput.addEventListener('input', () => {
    fileInput.value = '';
    sourceLabel.textContent = '当前来源：粘贴的表格';
    invalidate();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) textInput.value = '';
    sourceLabel.textContent = fileInput.files[0] ? `当前来源：文件 ${fileInput.files[0].name}` : '请选择文件或粘贴表格';
    invalidate();
  });
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
