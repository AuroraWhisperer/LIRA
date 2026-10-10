'use strict';

import { createSongBackgroundImages, prepareSongBackground } from './song-background-image.js';

const SONG_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
const SONG_BACKGROUND_ERROR_MESSAGES = {
  BACKGROUND_IMAGE_REQUIRED: '请选择图片文件。',
  PAYLOAD_TOO_LARGE: '图片超过 5MB，请压缩后再上传。',
  BACKGROUND_FORMAT_UNSUPPORTED: '仅支持 PNG / JPG / WebP / GIF 图片。',
  BACKGROUND_URL_INVALID: '服务器返回的背景地址无效。',
  BACKGROUND_PROCESSING_FAILED: '图片处理失败，请换一张图片重试。',
  BACKGROUND_IMAGE_TOO_DETAILED: '保持清晰度后图片仍超过 1 MB，请换一张细节较少的背景。',
  LICENSE_NOT_AUTHORIZED: '授权已失效，请重新授权。',
  DEVICE_REVOKED: '当前设备授权已被管理员撤销。',
  LICENSE_REVOKED: '当前授权已被撤销。',
  STREAMER_DISABLED: '当前主播账号已停用。',
  NETWORK_UNAVAILABLE: '无法连接授权服务器，请检查网络后重试。',
  REQUEST_TIMEOUT: '连接授权服务器超时，请重试。',
};

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
    const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1');
    return allowed && !url.username && !url.password ? url.href : '';
  } catch (_) {
    return '';
  }
}

function renderSongBackground(response, elements, previewUrl) {
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
  if (previewUrl) preview.src = previewUrl;
  else preview.removeAttribute('src');
  preview.hidden = !previewUrl;
  empty.hidden = true;
  deleteButton.hidden = false;
  const bytes = Number(background.bytes);
  const size = Number.isFinite(bytes) ? `${(bytes / 1024).toFixed(0)} KB` : '';
  const updatedAt = background.updatedAt ? new Date(background.updatedAt) : null;
  const updated = updatedAt && !Number.isNaN(updatedAt.getTime()) ? `更新于 ${updatedAt.toLocaleString('zh-CN')}` : '';
  meta.textContent = [updated, size].filter(Boolean).join(' · ');
}

export async function initCloudSongBackground() {
  if (typeof document === 'undefined' || !window.liraLicense) return;
  const section = document.getElementById('licenseSongBackground');
  const preview = document.getElementById('licenseSongBgPreview');
  const empty = document.getElementById('licenseSongBgEmpty');
  const meta = document.getElementById('licenseSongBgMeta');
  const fileInput = document.getElementById('licenseSongBgFile');
  const pickButton = document.getElementById('licenseSongBgPickBtn');
  const deleteButton = document.getElementById('licenseSongBgDeleteBtn');
  const result = document.getElementById('licenseSongBgResult');
  if (!section || !preview || !empty || !meta || !fileInput || !pickButton || !deleteButton || !result) return;

  const elements = { preview, empty, meta, deleteButton };
  const images = createSongBackgroundImages();
  const previewRequest = new AbortController();
  let disposed = false;
  let objectUrl = '';
  function releasePreview() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
  }
  function showBackground(response, blob) {
    if (disposed) return;
    releasePreview();
    if (blob) objectUrl = URL.createObjectURL(blob);
    renderSongBackground(response, elements, objectUrl);
  }
  window.addEventListener('pagehide', () => {
    disposed = true;
    previewRequest.abort();
    releasePreview();
  }, { once: true });
  preview.addEventListener('error', () => {
    result.textContent = '背景已保存，但预览加载失败，请重新打开此页面重试。';
  });
  section.hidden = false;

  async function refreshSongBackground() {
    const response = assertSongBackgroundResponse(await window.liraLicense.getSongPageBackground());
    if (!response?.background) {
      showBackground(response);
      await images.clear();
      return response;
    }
    const url = resolveSongBackgroundUrl(response.background.previewUrl);
    if (!url) throw new Error('BACKGROUND_URL_INVALID');
    try {
      showBackground(response, await images.read(url, previewRequest.signal));
    } catch (_) {
      showBackground(response);
      result.textContent = '背景已保存，但预览加载失败，请重新打开此页面重试。';
    }
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
    result.textContent = '正在压缩图片…';
    try {
      const blob = await prepareSongBackground(file);
      await images.stage(blob);
      result.textContent = '正在上传…';
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const response = assertSongBackgroundResponse(
        await window.liraLicense.uploadSongPageBackground(bytes, 'song-background.webp'),
      );
      const url = resolveSongBackgroundUrl(response?.background?.previewUrl);
      if (!url) throw new Error('BACKGROUND_URL_INVALID');
      const saved = await images.publish(url, blob);
      showBackground(response, blob);
      result.textContent = saved ? '背景已更新，已保存本地副本。' : '背景已更新；本地缓存未能保存，下次打开时将重新加载。';
    } catch (error) {
      result.textContent = `上传失败：${getSongBackgroundErrorMessage(error)}`;
    } finally {
      await images.discardDraft();
      setBusy(false);
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (deleteButton.disabled) return;
    setBusy(true);
    result.textContent = '正在恢复默认背景…';
    try {
      const response = assertSongBackgroundResponse(await window.liraLicense.deleteSongPageBackground());
      await images.clear();
      showBackground(response);
      result.textContent = '已恢复默认水彩背景。';
    } catch (error) {
      result.textContent = `恢复失败：${getSongBackgroundErrorMessage(error)}`;
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
