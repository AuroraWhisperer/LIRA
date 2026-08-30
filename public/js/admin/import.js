// 编写人：Aurora
// 数据导入导出解析
'use strict';

(function () {
  const { value, toast, showError, api, showConfirmationDialog } =
    window.AdminApp.utils;
  const SONG_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
  const SONG_BACKGROUND_ERROR_MESSAGES = {
    BACKGROUND_IMAGE_REQUIRED: '请选择图片文件。',
    PAYLOAD_TOO_LARGE: '图片超过 5MB，请压缩后再上传。',
    BACKGROUND_FORMAT_UNSUPPORTED: '仅支持 PNG / JPG / WebP / GIF 图片。',
    BACKGROUND_URL_INVALID: '服务器返回的背景地址无效。',
    LICENSE_NOT_AUTHORIZED: '授权已失效，请重新授权。',
    DEVICE_REVOKED: '当前设备授权已被管理员撤销。',
    LICENSE_REVOKED: '当前授权已被撤销。',
    STREAMER_DISABLED: '当前主播账号已停用。',
    NETWORK_UNAVAILABLE: '无法连接授权服务器，请检查网络后重试。',
    REQUEST_TIMEOUT: '连接授权服务器超时，请重试。',
  };

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
      isEnabled: [
        '是否可点',
        '可点',
        '是否启用',
        '启用',
        'isEnabled',
        'enabled',
      ],
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
      sourcePlatform: hasHeader
        ? findHeader(header, aliases.sourcePlatform)
        : 8,
      note: hasHeader ? findHeader(header, aliases.note) : 9,
    };

    return bodyRows
      .map((row) => ({
        name: readCell(row, indexes.name),
        artist: readCell(row, indexes.artist),
        categoryName: readCell(row, indexes.categoryName) || '默认',
        tags: readCell(row, indexes.tags),
        isEnabled: parseEnabledCell(readCell(row, indexes.isEnabled)),
        language: readCell(row, indexes.language),
        sourcePlatform: readCell(row, indexes.sourcePlatform),
        note: readCell(row, indexes.note),
        requestPrice: readCell(row, indexes.requestPrice),
        songClip: readCell(row, indexes.songClip),
      }))
      .filter((row) => row.name.trim());
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

  async function initCloudSongSync() {
    if (typeof document === 'undefined') return;
    const section = document.getElementById('licenseSongSync');
    const syncButton = document.getElementById('licenseSyncSongsBtn');
    const status = document.getElementById('licenseProfileStatus');
    const result = document.getElementById('licenseSyncResult');
    const link = document.getElementById('licenseSongPageLink');
    const cloudCountEl = document.getElementById('licenseCloudCount');
    const lastSyncEl = document.getElementById('licenseLastCloudSync');
    if (!section || !syncButton || !window.liraLicense) return;
    section.hidden = false;

    const LAST_SYNC_KEY = 'lira:license:lastCloudSync';
    let cloudSongCount = null;
    let syncConfirmationPending = false;

    function extractCloudSongCount(payload) {
      if (Array.isArray(payload)) return payload.length;
      if (Array.isArray(payload?.songs)) return payload.songs.length;
      if (Array.isArray(payload?.items)) return payload.items.length;
      return null;
    }

    function renderCloudSongCount() {
      if (!cloudCountEl) return;
      cloudCountEl.textContent =
        cloudSongCount === null
          ? '云端歌单数量暂时无法读取。'
          : `云端现有 ${cloudSongCount} 首歌曲。`;
    }

    async function refreshCloudSongCount() {
      try {
        cloudSongCount = extractCloudSongCount(
          await window.liraLicense.getCloudSongs(),
        );
      } catch (_) {
        cloudSongCount = null;
      }
      renderCloudSongCount();
    }

    function renderLastCloudSync() {
      if (!lastSyncEl) return;
      let record = null;
      try {
        record = JSON.parse(localStorage.getItem(LAST_SYNC_KEY) || 'null');
      } catch (_) {
        record = null;
      }
      lastSyncEl.textContent = record?.time
        ? `本机上次同步：${new Date(record.time).toLocaleString()}，共 ${Number(record.count) || 0} 首。`
        : '本机尚未同步过歌单；如果还有其他设备，先确认哪一边是最新的。';
    }

    // Do not allow an overwrite while the initial cloud count is still
    // loading; an older response could otherwise replace the post-sync count.
    syncButton.disabled = true;
    try {
      try {
        const profile = await window.liraLicense.getProfile();
        const streamer = profile?.streamer;
        status.textContent = streamer?.accountName
          ? `已绑定：${streamer.accountName}`
          : '已授权，但暂时无法读取主播资料。';
        if (
          streamer?.songPageUrl &&
          /^https:\/\//i.test(streamer.songPageUrl)
        ) {
          link.href = streamer.songPageUrl;
          link.hidden = false;
        }
      } catch (_) {
        status.textContent = '暂时无法读取云端账号信息。';
      }
      await refreshCloudSongCount();
      renderLastCloudSync();
    } finally {
      syncButton.disabled = false;
    }

    syncButton.addEventListener('click', async () => {
      if (syncButton.disabled || syncConfirmationPending) return;
      syncConfirmationPending = true;
      syncButton.disabled = true;
      const currentSongCount =
        Number(window['AdminApp']?.state?.getSongs?.()?.length) || 0;
      const description =
        cloudSongCount === null
          ? `当前本地歌库共 ${currentSongCount} 首，确认后网页歌单会被整体替换为本地歌库，其他设备或网页端的修改将丢失。`
          : `云端现有 ${cloudSongCount} 首，将被本地 ${currentSongCount} 首整体覆盖；如果其他设备或网页端刚改过歌单，改动将丢失。`;
      let confirmed = false;
      try {
        confirmed = await showConfirmationDialog({
          variant: 'caution',
          title: '同步会覆盖云端歌单',
          description,
          confirmLabel: '覆盖同步',
          initialFocus: 'cancel',
        });
      } catch (error) {
        result.textContent = `同步失败：${error?.message || '请稍后重试'}`;
      }
      if (!confirmed) {
        syncConfirmationPending = false;
        syncButton.disabled = false;
        return;
      }
      result.textContent = '正在同步当前歌库…';
      try {
        // Take the upload snapshot only after confirmation. The local song
        // list may be refreshed while the dialog is open; uploading the
        // earlier array could silently overwrite those newer local edits.
        const songs = [...(window['AdminApp']?.state?.getSongs?.() || [])];
        const response = await window.liraLicense.syncSongs(songs);
        if (!response?.ok) throw new Error(response?.error || '同步失败');
        const reportedCount = Number(response.count);
        const syncedCount =
          Number.isSafeInteger(reportedCount) && reportedCount >= 0
            ? reportedCount
            : songs.length;
        result.textContent = `已同步 ${syncedCount} 首歌曲。`;
        try {
          localStorage.setItem(
            LAST_SYNC_KEY,
            JSON.stringify({ time: Date.now(), count: syncedCount }),
          );
        } catch (error) {
          void error;
        }
        cloudSongCount = syncedCount;
        renderCloudSongCount();
        renderLastCloudSync();
        toast('云端歌单同步完成');
      } catch (error) {
        result.textContent = `同步失败：${error.message || '请稍后重试'}`;
      } finally {
        syncConfirmationPending = false;
        syncButton.disabled = false;
      }
    });
  }

  function getSongBackgroundErrorMessage(error) {
    const code = String(error?.code || error?.message || '');
    if (code.startsWith('DEVICE_TOKEN_')) return '授权已失效，请重新授权。';
    return SONG_BACKGROUND_ERROR_MESSAGES[code] || '操作失败，请稍后重试。';
  }

  function assertSongBackgroundResponse(response) {
    if (response?.ok === false || response?.error) {
      const error = new Error(String(response.error || 'LICENSE_ERROR'));
      error.code = String(response.error || 'LICENSE_ERROR');
      throw error;
    }
    return response;
  }

  function resolveSongBackgroundUrl(previewUrl) {
    try {
      const url = new URL(String(previewUrl || ''));
      const allowed =
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && url.hostname === '127.0.0.1');
      return allowed && !url.username && !url.password ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function renderSongBackground(response, elements) {
    const background = response?.background || null;
    const { preview, empty, meta, deleteButton } = elements;
    if (!background) {
      preview.hidden = true;
      preview.removeAttribute('src');
      empty.hidden = false;
      meta.textContent = '';
      deleteButton.hidden = true;
      return;
    }

    const url = resolveSongBackgroundUrl(background.previewUrl);
    if (!url) {
      throw Object.assign(new Error('BACKGROUND_URL_INVALID'), {
        code: 'BACKGROUND_URL_INVALID',
      });
    }
    preview.src = url;
    preview.hidden = false;
    empty.hidden = true;
    deleteButton.hidden = false;
    const bytes = Number(background.bytes);
    const size = Number.isFinite(bytes)
      ? `${(bytes / 1024).toFixed(0)} KB`
      : '';
    const updatedAt = background.updatedAt
      ? new Date(background.updatedAt)
      : null;
    const updated =
      updatedAt && !Number.isNaN(updatedAt.getTime())
        ? `更新于 ${updatedAt.toLocaleString('zh-CN')}`
        : '';
    meta.textContent = [updated, size].filter(Boolean).join(' · ');
  }

  async function initCloudSongBackground() {
    if (typeof document === 'undefined' || !window.liraLicense) return;
    const section = document.getElementById('licenseSongBackground');
    const preview = document.getElementById('licenseSongBgPreview');
    const empty = document.getElementById('licenseSongBgEmpty');
    const meta = document.getElementById('licenseSongBgMeta');
    const fileInput = document.getElementById('licenseSongBgFile');
    const pickButton = document.getElementById('licenseSongBgPickBtn');
    const deleteButton = document.getElementById('licenseSongBgDeleteBtn');
    const result = document.getElementById('licenseSongBgResult');
    if (
      !section ||
      !preview ||
      !empty ||
      !meta ||
      !fileInput ||
      !pickButton ||
      !deleteButton ||
      !result
    )
      return;

    const elements = { preview, empty, meta, deleteButton };
    section.hidden = false;

    async function refreshSongBackground() {
      const response = assertSongBackgroundResponse(
        await window.liraLicense.getSongPageBackground(),
      );
      renderSongBackground(response, elements);
      return response;
    }

    function setBusy(isBusy) {
      pickButton.disabled = isBusy;
      deleteButton.disabled = isBusy;
      fileInput.disabled = isBusy;
    }

    // Keep the controls disabled until the initial GET has rendered.  This
    // prevents a slow GET from overwriting a newly uploaded preview.
    setBusy(true);
    pickButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > SONG_BACKGROUND_MAX_BYTES) {
        result.textContent = '图片超过 5MB，请压缩后再上传。';
        return;
      }
      setBusy(true);
      result.textContent = '正在上传…';
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const response = assertSongBackgroundResponse(
          await window.liraLicense.uploadSongPageBackground(bytes, file.name),
        );
        renderSongBackground(response, elements);
        result.textContent = '背景已更新。';
      } catch (error) {
        result.textContent = `上传失败：${getSongBackgroundErrorMessage(error)}`;
      } finally {
        setBusy(false);
      }
    });

    deleteButton.addEventListener('click', async () => {
      if (deleteButton.disabled) return;
      setBusy(true);
      result.textContent = '正在删除…';
      try {
        const response = assertSongBackgroundResponse(
          await window.liraLicense.deleteSongPageBackground(),
        );
        renderSongBackground(response, elements);
        result.textContent = '背景已删除，歌单页将使用默认水彩背景。';
      } catch (error) {
        result.textContent = `删除失败：${getSongBackgroundErrorMessage(error)}`;
      } finally {
        setBusy(false);
      }
    });

    try {
      await refreshSongBackground();
    } catch (error) {
      result.textContent = `读取背景失败：${getSongBackgroundErrorMessage(error)}`;
    } finally {
      setBusy(false);
    }
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
