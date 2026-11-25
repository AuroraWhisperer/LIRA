// 编写人：Aurora
// 播放助手队列弹窗组件
'use strict';

import * as UIComponents from './components.js';
import { escapeHtml } from '../../shared/html-escape.js';
import { getQueueTrackKey, renderArtwork } from '../utils.js';

// Copy the row templates' primitive inputs: queue arrays and tracks can mutate in place.
function appendTrackValues(values, track) {
  values.push(track.id, track.songRequestKey, track.title, track.coverUrl,
    Array.isArray(track.artists) ? track.artists.join(' / ') : '', track.album, track.durationMs,
    track.vip, track.playable, track.source === 'local', Boolean(track.objectUrl), track.fileMissing);
}

function currentPlaylistIndex(state) {
  const tracks = state.normalQueueTracks || [];
  const currentKey = state.current ? getQueueTrackKey(state.current) : '';
  const cursorTrack = tracks[state.playlistIndex];
  return cursorTrack && getQueueTrackKey(cursorTrack) === currentKey
    ? state.playlistIndex
    : tracks.findIndex((track) => getQueueTrackKey(track) === currentKey);
}

function readQueueViewValues(state, tracks, fullPlaylist) {
  const values = [state.queueType, state.queueTitle, fullPlaylist, tracks.length];
  if (!fullPlaylist) {
    values.push(state.currentOrigin, Boolean(state.current), state.current ? getQueueTrackKey(state.current) : '');
  }
  for (const track of tracks) appendTrackValues(values, track);
  const pending = state.pendingRequests || [];
  values.push(pending.length);
  for (const item of pending) {
    values.push(item.songName, item.score, Array.isArray(item.reasons) ? item.reasons.join('；') : '');
    appendTrackValues(values, item.track || {});
  }
  return values;
}

/**
 * 队列弹窗管理器
 */
export class QueuePopup {
  constructor() {
    this.isOpen = false;
    this.popup = null;
    this.backdrop = null;
    this.queueBtn = null;
    this.listContainer = null;
    this.renderedValues = null;
    this.renderedPlaylistIndex = -1;
    this.failedCovers = new Map();
  }

  /**
   * 初始化队列弹窗
   */
  init() {
    this.popup = document.getElementById('queuePopup');
    this.backdrop = document.getElementById('queuePopupBackdrop');
    this.queueBtn = document.getElementById('playbackQueueBtn');
    this.listContainer = document.getElementById('playbackQueueList');
    // Capture the URL before the artwork fallback removes the failed image.
    this.listContainer?.addEventListener('error', ({ target }) => {
      if (target.matches('.playback-artwork > img')) {
        this.failedCovers.set(target.parentElement, target.getAttribute('src'));
      }
    }, true);
  }

  /**
   * 打开队列弹窗
   */
  open() {
    this.isOpen = true;
    this.popup?.classList.add('open');
    this.backdrop?.classList.add('open');
    this.queueBtn?.classList.add('active');
  }

  /**
   * 关闭队列弹窗
   */
  close() {
    const restoreFocus = this.popup?.contains(document.activeElement);
    this.isOpen = false;
    this.popup?.classList.remove('open');
    this.backdrop?.classList.remove('open');
    this.queueBtn?.classList.remove('active');
    if (restoreFocus) this.queueBtn?.focus();
  }

  /**
   * 切换队列弹窗显示状态
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * 渲染队列列表
   * @param {Object} state - 播放状态对象
   */
  render(state) {
    // Both opening paths render the latest state before scrolling to the current track.
    if (!this.listContainer || !this.isOpen) return;
    const fullPlaylist = state.queueType === 'playlist' && state.normalQueueTracks.length > 0;
    const tracks = fullPlaylist ? state.normalQueueTracks : this.getActiveQueue(state);
    const currentIndex = fullPlaylist ? currentPlaylistIndex(state) : -1;
    const previousIndex = this.renderedPlaylistIndex;
    this.renderedPlaylistIndex = currentIndex;
    const values = readQueueViewValues(state, tracks, fullPlaylist);
    if (this.renderedValues?.length === values.length
      && values.every((value, index) => value === this.renderedValues[index])) {
      if (previousIndex !== currentIndex) {
        for (const index of [previousIndex, currentIndex]) {
          if (index < 0) continue;
          const button = this.listContainer.querySelector(`[data-playback-playlist-jump="${index}"]`);
          const row = button.closest('.playback-queue-row');
          row.outerHTML = UIComponents.renderPlaylistRow(tracks[index], index, index === currentIndex).trim();
        }
        for (const [artwork, coverUrl] of this.failedCovers) {
          if (this.listContainer.contains(artwork)) artwork.outerHTML = renderArtwork({ coverUrl }).trim();
        }
        this.failedCovers.clear();
      }
      return;
    }
    this.failedCovers.clear();
    this.renderedValues = values;

    // 更新队列大小
    const queueSize = document.getElementById('queuePopupSize');
    if (queueSize) {
      queueSize.textContent = `${this.getTotalCount(state)} 首`;
    }

    // 更新队列标题
    const queueTitle = document.getElementById('queuePopupTitle');
    if (queueTitle) {
      queueTitle.textContent = state.queueTitle || '播放队列';
    }

    // 空队列
    if (this.getTotalCount(state) === 0 && !state.current && !state.pendingRequests?.length) {
      this.listContainer.innerHTML =
        '<div class="queue-empty-state lira-content-state"><div class="queue-empty-icon">♫</div><p class="lira-content-state-title">播放队列为空</p><span class="lira-content-state-description">搜索歌曲或从首页添加音乐</span></div>';
      return;
    }

    // 渲染各个部分
    const sections = [];

    // 1. 待确认点歌
    sections.push(this.renderPendingSection(state));

    // 2. 主队列
    if (fullPlaylist) {
      sections.push(this.renderFullPlaylistSection(state, currentIndex));
    } else {
      const queue = this.getActiveQueue(state);
      const origin = this.getActiveOrigin(state);
      sections.push(this.renderQueueSection(state.queueTitle, queue, origin, state));
    }

    const html = sections.filter(Boolean).join('');
    this.listContainer.innerHTML =
      html ||
      '<div class="queue-empty-state lira-content-state"><div class="queue-empty-icon">♫</div><p class="lira-content-state-title">播放队列为空</p><span class="lira-content-state-description">搜索歌曲或从首页添加音乐</span></div>';
  }

  /**
   * 滚动到当前播放的轨道
   */
  scrollToCurrent() {
    if (!this.listContainer) return;

    requestAnimationFrame(() => {
      const currentRow = this.listContainer.querySelector('.playback-queue-row.playlist-current');
      if (currentRow) {
        currentRow.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    });
  }

  /**
   * 获取总轨道数
   * @param {Object} state - 播放状态
   * @returns {number}
   */
  getTotalCount(state) {
    if (state.queueType === 'playlist') {
      return state.normalQueueTracks.length;
    }
    return this.getActiveQueue(state).length;
  }

  /**
   * 获取活动队列
   * @param {Object} state - 播放状态
   * @returns {Array}
   */
  getActiveQueue(state) {
    return state.queueType === 'radio' ? state.radioQueue : state.normalQueue;
  }

  /**
   * 获取活动队列来源
   * @param {Object} state - 播放状态
   * @returns {string}
   */
  getActiveOrigin(state) {
    return state.queueType === 'radio' ? 'radio' : 'normal';
  }

  /**
   * 渲染待确认点歌部分
   * @param {Object} state - 播放状态
   * @returns {string}
   */
  renderPendingSection(state) {
    if (!state.pendingRequests || !state.pendingRequests.length) return '';

    const rows = state.pendingRequests.map((item, index) => UIComponents.renderPendingRow(item, index)).join('');

    return `
      <section class="playback-queue-section">
        <h3 class="ui-card-title">待确认点歌 <span>${state.pendingRequests.length}</span></h3>
        ${rows}
      </section>
    `;
  }

  /**
   * 渲染完整歌单部分
   * @param {Object} state - 播放状态
   * @param {number} currentIndex - 歌单中正在播放的位置
   * @returns {string}
   */
  renderFullPlaylistSection(state, currentIndex = currentPlaylistIndex(state)) {
    const tracks = state.normalQueueTracks;
    if (!tracks || !tracks.length) return '';

    const rows = tracks
      .map((track, index) => {
        const isCurrent = index === currentIndex;
        return UIComponents.renderPlaylistRow(track, index, isCurrent);
      })
      .join('');

    return `
      <section class="playback-queue-section">
        ${state.pendingRequests?.length ? `<h3 class="ui-card-title">${escapeHtml(state.queueTitle)} <span>${tracks.length}</span></h3>` : ''}
        ${rows}
      </section>
    `;
  }

  /**
   * 渲染普通队列部分
   * @param {string} title - 队列标题
   * @param {Array} queue - 队列数组
   * @param {string} origin - 队列来源
   * @param {Object} state - 播放状态
   * @returns {string}
   */
  renderQueueSection(title, queue, origin, state) {
    if (!queue || !queue.length) return '';

    const rows = queue
      .map((track, index) =>
        UIComponents.renderQueueRow(track, origin, index, false, state.current, state.currentOrigin),
      )
      .join('');

    return `
      <section class="playback-queue-section">
        ${state.pendingRequests?.length ? `<h3 class="ui-card-title">${escapeHtml(title)} <span>${queue.length}</span></h3>` : ''}
        ${rows}
      </section>
    `;
  }
}
