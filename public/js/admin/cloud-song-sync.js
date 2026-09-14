'use strict';

const LAST_SYNC_KEY = 'lira:license:lastCloudSync';

function safeSongIndex(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function createSongSyncError(response) {
  const code = String(response?.error || 'SONG_SYNC_FAILED');
  const error = new Error(code);
  error.code = code;
  const index = safeSongIndex(response?.index);
  if (index !== undefined) error.index = index;
  return error;
}

function songSyncErrorMessage(error) {
  const code = String(error?.code || error?.message || '');
  if (code === 'INVALID_SONG') {
    const index = safeSongIndex(error?.index);
    return index === undefined
      ? '歌库中有歌曲字段格式无效，请检查点歌价格、启用状态或排序后重试。'
      : `第 ${index + 1} 首歌曲的字段格式无效，请检查点歌价格、启用状态或排序后重试。`;
  }
  if (code === 'SONG_LIST_INVALID' || code === 'SONGS_ARRAY_REQUIRED')
    return '歌库格式无效，请重试。';
  if (code === 'TOO_MANY_SONGS') return '歌库超过 5000 首限制。';
  if (code === 'NETWORK_UNAVAILABLE')
    return '无法连接授权服务器，请检查网络后重试。';
  if (code === 'REQUEST_TIMEOUT') return '连接授权服务器超时，请重试。';
  return '请稍后重试。';
}

function extractCloudSongCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.songs)) return payload.songs.length;
  if (Array.isArray(payload?.items)) return payload.items.length;
  return null;
}

function renderCloudSongCount(cloudCountEl, cloudSongCount) {
  if (!cloudCountEl) return;
  cloudCountEl.textContent =
    cloudSongCount === null
      ? '暂时无法读取'
      : `${cloudSongCount} 首`;
}

function renderLastCloudSync(lastSyncEl) {
  if (!lastSyncEl) return;
  let record = null;
  try {
    record = JSON.parse(localStorage.getItem(LAST_SYNC_KEY) || 'null');
  } catch (_) {
    record = null;
  }
  lastSyncEl.textContent = record?.time
    ? `本机上次同步：${new Date(record.time).toLocaleString()}，共 ${Number(record.count) || 0} 首。`
    : '本机尚未同步过歌单。';
}

export async function initCloudSongSync({
  getSongs,
  toast,
  showConfirmationDialog,
}) {
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

  let cloudSongCount = null;
  let syncConfirmationPending = false;

  async function refreshCloudSongCount() {
    try {
      cloudSongCount = extractCloudSongCount(
        await window.liraLicense.getCloudSongs(),
      );
    } catch (_) {
      cloudSongCount = null;
    }
    renderCloudSongCount(cloudCountEl, cloudSongCount);
  }

  // Do not allow an overwrite while the initial cloud count is still
  // loading; an older response could otherwise replace the post-sync count.
  syncButton.disabled = true;
  try {
    try {
      const profile = await window.liraLicense.getProfile();
      const streamer = profile?.streamer;
      status.textContent = streamer?.accountName
        ? streamer.accountName
        : '已授权，但暂时无法读取主播资料。';
      if (streamer?.songPageUrl && /^https:\/\//i.test(streamer.songPageUrl)) {
        link.href = streamer.songPageUrl;
        link.hidden = false;
      }
    } catch (_) {
      status.textContent = '暂时无法读取云端账号信息。';
    }
    await refreshCloudSongCount();
    renderLastCloudSync(lastSyncEl);
  } finally {
    syncButton.disabled = false;
  }

  syncButton.addEventListener('click', async () => {
    if (syncButton.disabled || syncConfirmationPending) return;
    syncConfirmationPending = true;
    syncButton.disabled = true;
    const currentSongCount = Number(getSongs()?.length) || 0;
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
      const songs = [...(getSongs() || [])];
      const response = await window.liraLicense.syncSongs(songs);
      if (!response?.ok) throw createSongSyncError(response);
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
      renderCloudSongCount(cloudCountEl, cloudSongCount);
      renderLastCloudSync(lastSyncEl);
      toast('云端歌单同步完成');
    } catch (error) {
      result.textContent = `同步失败：${songSyncErrorMessage(error)}`;
    } finally {
      syncConfirmationPending = false;
      syncButton.disabled = false;
    }
  });
}
