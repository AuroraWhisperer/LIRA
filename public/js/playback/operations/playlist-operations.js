// 编写人：Aurora
// 歌单操作模块
'use strict';

import * as PlaybackUtils from '../utils.js';
import * as PlaybackComponents from '../ui/components.js';

/**
 * 创建歌单操作模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 歌单操作函数集合
 */
export function createPlaylistOperations(deps) {
  const {
    playbackState,
    homeService,
    toast,
    showError,
    readJsonResponse,
    renderPlayback,
    escapeHtml
  } = deps;

  /**
   * 检查轨道是否可以添加到歌单
   */
  function canAddTrackToPlaylist(track) {
    if (!track) return false;
    if (track.source === 'qq') return Number(track.sourceSongId) > 0;
    if (track.source === 'netease') return /^\d+$/.test(String(track.sourceTrackId || '').replace(/^netease:/, ''));
    return false;
  }

  /**
   * 显示确认对话框
   */
  function showConfirmDialog(title, message, trackName, confirmText = '确认', cancelText = '取消') {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'confirm-dialog-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');

      backdrop.innerHTML = `
        <div class="confirm-dialog">
          <div class="confirm-dialog-header">
            <h3>${escapeHtml(title)}</h3>
          </div>
          <div class="confirm-dialog-body">
            ${escapeHtml(message)}
            ${trackName ? `<div class="confirm-dialog-track">${escapeHtml(trackName)}</div>` : ''}
          </div>
          <div class="confirm-dialog-footer">
            <button type="button" class="confirm-cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="confirm-delete">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      let settled = false;
      const close = (confirmed = false) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
        resolve(confirmed);
      };

      const handleKeydown = (event) => {
        if (event.key === 'Escape') close(false);
        if (event.key === 'Enter') close(true);
      };

      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          close(false);
          return;
        }
        if (event.target.closest('.confirm-cancel')) {
          close(false);
          return;
        }
        if (event.target.closest('.confirm-delete')) {
          close(true);
        }
      });

      document.addEventListener('keydown', handleKeydown);
      document.body.appendChild(backdrop);
      backdrop.querySelector('.confirm-delete')?.focus();
    });
  }

  /**
   * 显示歌单选择器
   */
  function choosePlaylistForTrack(platformLabel, playlists, track) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'playlist-picker-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      const availableCount = playlists.filter((item) => item.containsTrack === false).length;
      backdrop.innerHTML = `
        <div class="playlist-picker-dialog">
          <div class="playlist-picker-header">
            <div>
              <h3>添加到${escapeHtml(platformLabel)}歌单</h3>
              <p>${escapeHtml(track.title || '当前歌曲')} · ${availableCount} 个歌单可添加</p>
            </div>
            <button type="button" class="playlist-picker-close" aria-label="关闭">×</button>
          </div>
          <div class="playlist-picker-list">
            ${playlists.map((item, index) => {
              const isAdded = item.containsTrack === true;
              const checkFailed = item.containsTrack == null;
              const status = isAdded ? '已添加' : (checkFailed ? '检查失败' : '可添加');
              return `
                <button type="button" class="playlist-picker-item${isAdded ? ' is-added' : ''}" data-playlist-picker-index="${index}" ${isAdded || checkFailed ? 'disabled' : ''}>
                  ${PlaybackUtils.renderArtwork(item, { fallback: '单' })}
                  <span class="playlist-picker-name">${escapeHtml(item.title || item.id)}</span>
                  <span class="playlist-picker-status">${status}</span>
                </button>
              `;
            }).join('')}
          </div>
          <div class="playlist-picker-footer">
            <span>已添加的歌单不可重复选择</span>
            <button type="button" class="playlist-picker-cancel">取消</button>
          </div>
        </div>
      `;

      let settled = false;
      const close = (playlist = null) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
        resolve(playlist);
      };
      const handleKeydown = (event) => {
        if (event.key === 'Escape') close();
      };
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop || event.target.closest('.playlist-picker-close, .playlist-picker-cancel')) {
          close();
          return;
        }
        const button = event.target.closest('[data-playlist-picker-index]');
        if (!button || button.disabled) return;
        close(playlists[Number(button.dataset.playlistPickerIndex)] || null);
      });
      document.addEventListener('keydown', handleKeydown);
      document.body.appendChild(backdrop);
      backdrop.querySelector('.playlist-picker-item:not(:disabled), .playlist-picker-close')?.focus();
    });
  }

  /**
   * 从歌单中删除轨道
   */
  async function removeTrackFromPlaylist(track, action) {
    if (!track) return;

    const homeState = homeService.getHomeState();
    const platform = playbackState.selectedSource;
    const platformLabel = platform === 'netease' ? '网易云音乐' : 'QQ 音乐';

    if (action === 'liked') {
      const confirmed = await showConfirmDialog(
        '从我喜欢中删除',
        '确认要删除这首歌曲吗？',
        track.title || '当前歌曲',
        '删除',
        '取消'
      );
      if (!confirmed) return;

      try {
        toast('正在从我喜欢中删除…');
        const response = await fetch('/api/music/playlists/tracks/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            playlist: { id: 'liked' },
            tracks: [track]
          })
        });
        const payload = await readJsonResponse(response, `从我喜欢删除失败`);
        if (!response.ok || !payload.ok) throw new Error(payload.error || `从我喜欢删除失败`);

        toast('已从我喜欢中删除');
        await homeService.refreshContent();
        const updatedState = homeService.getHomeState();
        if (deps.renderPlaybackHomeResults) {
          deps.renderPlaybackHomeResults(updatedState.action);
        }
      } catch (error) {
        showError(error);
      }
      return;
    }

    if (action === 'playlist-tracks') {
      const currentPlaylist = homeService.getCurrentPlaylist();
      if (!currentPlaylist) return;

      const confirmed = await showConfirmDialog(
        `从歌单中删除`,
        `确认从「${currentPlaylist.title || '歌单'}」中删除这首歌曲吗？`,
        track.title || '当前歌曲',
        '删除',
        '取消'
      );
      if (!confirmed) return;

      try {
        toast('正在从歌单中删除…');
        const response = await fetch('/api/music/playlists/tracks/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            playlist: currentPlaylist,
            tracks: [track]
          })
        });
        const payload = await readJsonResponse(response, `从${platformLabel}歌单删除失败`);
        if (!response.ok || !payload.ok) throw new Error(payload.error || `从${platformLabel}歌单删除失败`);

        toast(`已从「${currentPlaylist.title || '歌单'}」中删除`);
        await homeService.refreshContent();
        const updatedState = homeService.getHomeState();
        if (deps.renderPlaybackHomeResults) {
          deps.renderPlaybackHomeResults(updatedState.action);
        }
      } catch (error) {
        showError(error);
      }
    }
  }

  /**
   * 添加轨道到歌单
   */
  async function addTrackToPlaylist(track) {
    if (!canAddTrackToPlaylist(track)) {
      toast('这首歌曲缺少平台歌曲 ID，暂时无法添加到歌单');
      return;
    }
    const platform = track.source;
    const platformLabel = platform === 'netease' ? '网易云音乐' : 'QQ 音乐';
    try {
      toast('正在检查歌单中的歌曲…');
      const listResponse = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, action: 'created-playlists', limit: 500, refresh: true, track })
      });
      const listPayload = await readJsonResponse(listResponse, `加载${platformLabel}歌单失败`);
      if (!listResponse.ok || !listPayload.ok) throw new Error(listPayload.error || `加载${platformLabel}歌单失败`);
      const playlists = Array.isArray(listPayload.data && listPayload.data.playlists)
        ? listPayload.data.playlists.filter((item) => item && (
          platform === 'qq'
            ? item.dirId && (item.tid || item.id)
            : item.id
        ))
        : [];
      if (playlists.length === 0) throw new Error(`没有找到可写入的${platformLabel}歌单`);
      const playlist = await choosePlaylistForTrack(platformLabel, playlists, track);
      if (!playlist) return;
      const confirmed = await PlaybackComponents.showConfirmDialog({
        title: `添加到${platformLabel}歌单`,
        message: `确认将「${track.title || '当前歌曲'}」添加到「${playlist.title || playlist.id}」？`,
        confirmText: '确定',
        cancelText: '取消'
      });
      if (!confirmed) return;

      const writeResponse = await fetch('/api/music/playlists/tracks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, playlist, tracks: [track] })
      });
      const writePayload = await readJsonResponse(writeResponse, `添加到${platformLabel}歌单失败`);
      if (!writeResponse.ok || !writePayload.ok) throw new Error(writePayload.error || `添加到${platformLabel}歌单失败`);
      const song = writePayload.data && writePayload.data.result
        && Array.isArray(writePayload.data.result.songlist)
        ? writePayload.data.result.songlist[0]
        : null;
      toast(song && Number(song.existed) === 1
        ? `歌曲已在「${playlist.title}」中`
        : `已添加到「${playlist.title}」`);
    } catch (error) {
      showError(error);
    }
  }

  /**
   * 添加当前播放的轨道到歌单
   */
  async function addCurrentTrackToPlaylist() {
    const track = playbackState.current;
    if (!track) {
      toast('当前没有播放歌曲');
      return;
    }
    await addTrackToPlaylist(track);
  }

  return {
    canAddTrackToPlaylist,
    removeTrackFromPlaylist,
    addTrackToPlaylist,
    addCurrentTrackToPlaylist
  };
}
