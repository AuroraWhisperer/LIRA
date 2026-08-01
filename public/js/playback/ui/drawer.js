// 编写人：Aurora
// 播放助手抽屉组件
'use strict';

import * as PlaybackUtils from '../utils.js';
import * as UIComponents from './components.js';

/**
 * 抽屉管理器
 */
export class Drawer {
  constructor() {
    this.drawer = null;
    this.backdrop = null;
    this.titleEl = null;
    this.subtitleEl = null;
    this.bodyEl = null;
    this.actionsEl = null;
    this.backBtn = null;
    this.refreshBtn = null;
    this.headerPlayAllBtn = null;
    this.history = [];
  }

  /**
   * 初始化抽屉
   */
  init() {
    this.drawer = document.getElementById('playbackDrawer');
    this.backdrop = document.getElementById('playbackDrawerBackdrop');
    this.titleEl = document.getElementById('playbackDrawerTitle');
    this.subtitleEl = document.getElementById('playbackDrawerSubtitle');
    this.bodyEl = document.getElementById('playbackDrawerBody');
    this.actionsEl = document.getElementById('playbackDrawerActions');
    this.backBtn = document.getElementById('playbackDrawerBack');
    this.refreshBtn = document.getElementById('playbackDrawerRefresh');
    this.headerPlayAllBtn = document.getElementById('playbackDrawerPlayAllHeader');
  }

  /**
   * 打开抽屉
   * @param {string} title - 标题
   * @param {string} subtitle - 副标题
   * @param {boolean} loading - 是否显示加载状态
   */
  open(title, subtitle, loading = false, loadingHint = '') {
    this.drawer?.classList.add('open');
    this.backdrop?.classList.add('open');

    if (this.titleEl) this.titleEl.textContent = title || '浏览内容';
    if (this.subtitleEl) this.subtitleEl.textContent = subtitle || '';

    if (this.backBtn) {
      this.backBtn.style.display = this.history.length > 0 ? '' : 'none';
    }

    if (loading) {
      this.setLoading('正在加载...', loadingHint);
    }
  }

  /**
   * 关闭抽屉
   */
  close() {
    this.drawer?.classList.remove('open');
    this.backdrop?.classList.remove('open');
    this.history = [];

    // 取消卡片高亮
    document.querySelectorAll('[data-playback-home-action]').forEach((btn) => {
      btn.classList.remove('active');
    });
  }

  /**
   * 返回上一级
   */
  goBack() {
    if (!this.history.length) {
      this.close();
      return;
    }

    const prev = this.history.pop();
    this.renderContent(prev.items, prev.itemType, prev.action, prev.title, prev.page);

    if (this.backBtn) {
      this.backBtn.style.display = this.history.length > 0 ? '' : 'none';
    }
  }

  /**
   * 保存当前状态到历史
   * @param {Array} items - 项目列表
   * @param {string} itemType - 项目类型
   * @param {string} action - 操作类型
   * @param {string} title - 标题
   * @param {number} page - 页码
   */
  pushHistory(items, itemType, action, title, page) {
    this.history.push({
      items: items.slice(),
      itemType,
      action,
      title,
      page
    });
  }

  /**
   * 设置加载状态
   * @param {string} message - 加载消息
   */
  setLoading(message, hint = '') {
    if (!this.bodyEl) return;

    const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));
    const hintHtml = hint ? `<small>${escapeHtml(hint)}</small>` : '';
    this.bodyEl.innerHTML = `<div class="playback-drawer-loading"><span>${escapeHtml(message)}</span>${hintHtml}</div>`;
    this.updateActions(false);
  }

  /**
   * 设置错误状态
   * @param {string} message - 错误消息
   */
  setError(message) {
    if (!this.bodyEl) return;

    const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));
    this.bodyEl.innerHTML = `<p class="hint" style="text-align:center;padding:40px 0;color:var(--danger);">${escapeHtml(message)}</p>`;
    this.updateActions(false);
  }

  /**
   * 渲染内容
   * @param {Array} items - 项目列表
   * @param {string} itemType - 项目类型 ('playlist' 或 'track')
   * @param {string} action - 操作类型
   * @param {string} title - 标题（可选）
   * @param {number} page - 页码（可选）
   */
  renderContent(items, itemType, action = '', title = '', page = 1) {
    if (!this.bodyEl) return;

    if (!items || !items.length) {
      this.bodyEl.innerHTML = '<p class="hint" style="text-align:center;padding:40px 0;">暂无内容</p>';
      this.updateActions(false, action);
      return;
    }

    // 更新标题
    const heading = title || PlaybackUtils.getHomeActionTitle(action);
    if (this.titleEl) this.titleEl.textContent = heading;

    // 更新副标题
    if (this.subtitleEl) {
      this.subtitleEl.textContent = itemType === 'playlist'
        ? `${items.length} 个歌单`
        : `${items.length} 首`;
    }

    // 渲染内容
    if (itemType === 'playlist') {
      this.renderPlaylists(items);
      this.updateActions(false, action);
    } else {
      this.renderTracks(items, action);
      this.updateActions(true, action);
    }
  }

  /**
   * 渲染歌单列表
   * @param {Array} playlists - 歌单数组
   */
  renderPlaylists(playlists) {
    if (!this.bodyEl) return;

    const html = playlists
      .map((playlist, index) => UIComponents.renderPlaylistCard(playlist, index))
      .join('');

    this.bodyEl.innerHTML = html;
  }

  /**
   * 渲染轨道列表
   * @param {Array} tracks - 轨道数组
   * @param {string} action - 操作类型
   */
  renderTracks(tracks, action = '') {
    if (!this.bodyEl) return;

    const html = tracks
      .map((track, index) => UIComponents.renderHomeTrackRow(track, index, 'home', action))
      .join('');

    this.bodyEl.innerHTML = html;
  }

  /**
   * 更新底部操作按钮
   * @param {boolean} showPlayAll - 是否显示"播放全部"按钮
   * @param {string} action - 操作类型（用于判断是否显示刷新按钮）
   */
  updateActions(showPlayAll, action = '') {
    const canRefresh = ['personalized', 'daily', 'radio'].includes(action);

    // 头部刷新按钮
    if (this.refreshBtn) {
      this.refreshBtn.hidden = !canRefresh;
    }

    // 头部播放全部按钮
    if (this.headerPlayAllBtn) {
      this.headerPlayAllBtn.hidden = !showPlayAll;
    }

    // 底部操作按钮
    if (!this.actionsEl) return;

    this.actionsEl.innerHTML = '';

    if (showPlayAll) {
      this.actionsEl.innerHTML += '<button id="playbackDrawerPlayAll" type="button">播放全部</button>';
      this.actionsEl.innerHTML += '<button id="playbackDrawerShuffleAll" type="button">随机播放</button>';
    }

    this.actionsEl.hidden = !showPlayAll;
  }

  /**
   * 清空历史
   */
  clearHistory() {
    this.history = [];
  }
}
