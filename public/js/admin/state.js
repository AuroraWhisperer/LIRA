// 编写人：Aurora
// 全局状态管理和数据加载
'use strict';

import { showError, value } from '../shared/utils.js';
import { eventBus, Events } from '../shared/event-bus.js';
import { readSelectedCategories, readSelectedTags } from './song-category-filter.js';

/**
 * 状态管理服务
 * 负责管理应用状态、歌曲数据和WebSocket连接
 */
export class StateService {
  constructor() {
    this.appState = null;
    this.songs = [];
    this.categories = [];
    this.songReloadTimer = null;
    this.shuttingDown = false;
    this.songLanguages = new Set();
    this.songArtists = new Set();
    this.songTags = new Set();
    this.ws = null;
    this.lyricVersion = { generation: null, sequence: 0 };
  }

  /**
   * 连接WebSocket
   */
  connectSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = window.__API_TOKEN__;
    const wsUrl = `${protocol}//${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
    this.ws = new WebSocket(wsUrl);
    const status = document.getElementById('wsStatus');

    this.ws.addEventListener('open', () => {
      status.hidden = true;
      eventBus.emit('ws:connected');
    });

    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'snapshot') {
        const previousLyricState = this.appState?.lyricState;
        this.appState = payload.state;
        const lyricAccepted = this.acceptLyricState(this.appState?.lyricState);
        if (!lyricAccepted && previousLyricState) {
          this.appState.lyricState = previousLyricState;
        }
        dispatchRealtimeState('app:wesing-state', this.appState?.weSing);
        if (lyricAccepted) {
          dispatchRealtimeState('app:lyric-state', this.appState?.lyricState);
        }
        dispatchRealtimeState('app:lyric-timeline', this.appState?.lyricTimeline);
        dispatchRealtimeState('app:settings-state', this.appState?.settings);
        // 发布事件而非直接调用其他模块
        eventBus.emit(Events.STATE_LOADED, {
          state: this.appState,
          songs: this.songs
        });
        if (isGiftSnapshotReason(payload.reason)) {
          eventBus.emit(Events.GIFT_RECEIVED, { reason: payload.reason });
        }
        if (isSongsSnapshotReason(payload.reason)) {
          this.scheduleSongReload();
        }
      } else if (payload.type === 'overtime:update') {
        const currentRevision = Number(this.appState?.overtime?.revision) || 0;
        const nextRevision = Number(payload.state?.revision) || 0;
        if (nextRevision <= currentRevision) return;
        this.appState = this.appState || {};
        this.appState.overtime = payload.state;
        eventBus.emit(Events.OVERTIME_UPDATED, payload);
      } else if (payload.type === 'wesing-state') {
        this.appState = this.appState || {};
        this.appState.weSing = payload.state;
        dispatchRealtimeState('app:wesing-state', payload.state);
      } else if (payload.type === 'lyric-state') {
        if (!this.acceptLyricState(payload.state)) return;
        this.appState = this.appState || {};
        this.appState.lyricState = payload.state;
        dispatchRealtimeState('app:lyric-state', payload.state);
      } else if (payload.type === 'lyric-timeline') {
        this.appState = this.appState || {};
        this.appState.lyricTimeline = payload.timeline;
        dispatchRealtimeState('app:lyric-timeline', payload.timeline);
      } else if (payload.type === 'game:update') {
        dispatchRealtimeState('app:game-update', payload.session, true);
      } else if (payload.type === 'wheel:update') {
        dispatchRealtimeState('app:wheel-update', payload.state, true);
      }
    });

    this.ws.addEventListener('close', () => {
      status.hidden = false;
      if (this.shuttingDown) {
        status.textContent = '程序已退出';
        status.className = 'pill warn';
        eventBus.emit('app:shutdown');
        return;
      }
      status.textContent = '前端连接断开，重连中';
      status.className = 'pill warn';
      eventBus.emit('ws:disconnected');
      setTimeout(() => this.connectSocket(), 1600);
    });
  }

  /**
   * 重新加载所有数据
   */
  async reloadAll() {
    await this.reloadState();
    await this.reloadSongs({ reloadState: false });
  }

  /**
   * 重新加载应用状态
   */
  async reloadState() {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '读取状态失败');

    const previousLyricState = this.appState?.lyricState;
    this.appState = payload.data;
    if (!this.acceptLyricState(this.appState?.lyricState) && previousLyricState) {
      this.appState.lyricState = previousLyricState;
    }
    dispatchRealtimeState('app:settings-state', this.appState?.settings);
    if (this.acceptLyricState(this.appState?.lyricState)) {
      dispatchRealtimeState('app:lyric-state', this.appState?.lyricState);
    }
    dispatchRealtimeState('app:lyric-timeline', this.appState?.lyricTimeline);
    this.categories = this.appState.categories || [];
    this.songTags = new Set(this.appState.tags || []);

    // 发布状态更新事件
    eventBus.emit(Events.STATE_LOADED, {
      state: this.appState,
      songs: this.songs
    });
  }

  /**
   * 重新加载歌曲列表
   */
  async reloadSongs(options = {}) {
    const params = new URLSearchParams();
    if (value('songSearch')) params.set('query', value('songSearch'));
    for (const category of readSelectedCategories()) {
      params.append('category', category);
    }
    if (value('languageFilter')) params.set('language', value('languageFilter'));
    if (value('artistFilter')) params.set('artist', value('artistFilter'));
    for (const tag of readSelectedTags()) {
      params.append('tag', tag);
    }
    if (value('enabledFilter') === 'true') params.set('enabledOnly', 'true');

    const response = await fetch(`/api/songs?${params}`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '读取歌库失败');

    this.songs = payload.data || [];
    if (options.reloadState !== false) {
      await this.reloadState();
    }

    // 发布歌曲更新事件
    eventBus.emit(Events.SONG_UPDATED, {
      songs: this.songs,
      languages: this.songLanguages,
      artists: this.songArtists,
      tags: this.songTags
    });
  }

  /**
   * 延迟重新加载歌曲
   */
  scheduleSongReload() {
    clearTimeout(this.songReloadTimer);
    this.songReloadTimer = setTimeout(() => {
      this.reloadSongs({ reloadState: false }).catch(showError);
    }, 240);
  }

  /**
   * 获取应用状态
   */
  getAppState() {
    return this.appState;
  }

  /**
   * 获取歌曲列表
   */
  getSongs() {
    return this.songs;
  }

  /**
   * 获取分类列表
   */
  getCategories() {
    return this.categories;
  }

  /**
   * 获取歌曲语言列表
   */
  getSongLanguages() {
    return this.songLanguages;
  }

  /**
   * 获取歌手列表
   */
  getSongArtists() {
    return this.songArtists;
  }

  /**
   * 设置关闭状态
   */
  setShuttingDown(value) {
    this.shuttingDown = value;
  }

  acceptLyricState(state) {
    if (!state || typeof state !== 'object') return false;
    const generation = Number(state.generation);
    const sequence = Number(state.sequence);
    if (!Number.isFinite(generation) || !Number.isFinite(sequence)) {
      return this.lyricVersion.generation === null;
    }
    if (this.lyricVersion.generation === null || generation > this.lyricVersion.generation) {
      this.lyricVersion = { generation, sequence };
      return true;
    }
    if (generation < this.lyricVersion.generation || sequence <= this.lyricVersion.sequence) return false;
    this.lyricVersion.sequence = sequence;
    return true;
  }
}

function dispatchRealtimeState(eventName, state, allowEmpty = false) {
  if ((!state && !allowEmpty) || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: state }));
}

function isGiftSnapshotReason(reason) {
  return reason === 'bilibili:gift'
    || reason === 'gift:clear-recent'
    || reason === 'database:clear-gifts'
    || reason === 'database:clear-all';
}

function isSongsSnapshotReason(reason) {
  return String(reason || '').startsWith('songs:');
}

// 创建单例实例
export const stateService = new StateService();

// 【过渡期兼容层】- 保持window.AdminApp.state可用
// 阶段5时删除
if (typeof window !== 'undefined') {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.state = {
    connectSocket: () => stateService.connectSocket(),
    reloadAll: () => stateService.reloadAll(),
    reloadState: () => stateService.reloadState(),
    reloadSongs: () => stateService.reloadSongs(),
    scheduleSongReload: () => stateService.scheduleSongReload(),
    getAppState: () => stateService.getAppState(),
    getSongs: () => stateService.getSongs(),
    getCategories: () => stateService.getCategories(),
    getSongLanguages: () => stateService.getSongLanguages(),
    getSongArtists: () => stateService.getSongArtists(),
    setShuttingDown: (v) => stateService.setShuttingDown(v)
  };
}
