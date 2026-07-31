// 编写人：Aurora
// 播放助手队列弹窗组件
'use strict';

import * as PlaybackUtils from '../utils.js';
import * as UIComponents from './components.js';

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
  }

  /**
   * 初始化队列弹窗
   */
  init() {
    this.popup = document.getElementById('queuePopup');
    this.backdrop = document.getElementById('queuePopupBackdrop');
    this.queueBtn = document.getElementById('playbackQueueBtn');
    this.listContainer = document.getElementById('playbackQueueList');
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
    this.isOpen = false;
    this.popup?.classList.remove('open');
    this.backdrop?.classList.remove('open');
    this.queueBtn?.classList.remove('active');
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
    if (!this.listContainer) return;

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
    if (this.getTotalCount(state) === 0 && !state.current) {
      this.listContainer.innerHTML = '<div class="empty">播放队列为空</div>';
      return;
    }

    // 渲染各个部分
    const sections = [];

    // 1. 待确认点歌
    sections.push(this.renderPendingSection(state));

    // 2. 主队列
    if (state.queueType === 'playlist' && state.normalQueueTracks.length > 0) {
      sections.push(this.renderFullPlaylistSection(state));
    } else {
      const queue = this.getActiveQueue(state);
      const origin = this.getActiveOrigin(state);
      sections.push(this.renderQueueSection(state.queueTitle, queue, origin, state));
    }

    const html = sections.filter(Boolean).join('');
    this.listContainer.innerHTML = html || '<div class="empty">播放队列为空</div>';
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

    const rows = state.pendingRequests
      .map((item, index) => UIComponents.renderPendingRow(item, index))
      .join('');

    return `
      <section class="playback-queue-section">
        <h3>待确认点歌 <span>${state.pendingRequests.length}</span></h3>
        ${rows}
      </section>
    `;
  }

  /**
   * 渲染完整歌单部分
   * @param {Object} state - 播放状态
   * @returns {string}
   */
  renderFullPlaylistSection(state) {
    const tracks = state.normalQueueTracks;
    if (!tracks || !tracks.length) return '';

    const currentIndex = state.playlistIndex;
    const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));

    const rows = tracks.map((track, index) => {
      const isCurrent = index === currentIndex;
      const isPast = index < currentIndex;
      return UIComponents.renderPlaylistRow(track, index, isCurrent, isPast);
    }).join('');

    return `
      <section class="playback-queue-section">
        <h3>${escapeHtml(state.queueTitle)} <span>${tracks.length}</span></h3>
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

    const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));

    const rows = queue.map((track, index) =>
      UIComponents.renderQueueRow(track, origin, index, false, state.current, state.currentOrigin)
    ).join('');

    return `
      <section class="playback-queue-section">
        <h3>${escapeHtml(title)} <span>${queue.length}</span></h3>
        ${rows}
      </section>
    `;
  }
}
