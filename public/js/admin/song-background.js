'use strict';

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
  const size = Number.isFinite(bytes) ? `${(bytes / 1024).toFixed(0)} KB` : '';
  const updatedAt = background.updatedAt
    ? new Date(background.updatedAt)
    : null;
  const updated =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? `更新于 ${updatedAt.toLocaleString('zh-CN')}`
      : '';
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
    result.textContent = '正在恢复默认背景…';
    try {
      const response = assertSongBackgroundResponse(
        await window.liraLicense.deleteSongPageBackground(),
      );
      renderSongBackground(response, elements);
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
