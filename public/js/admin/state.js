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
      status.textContent = '前端实时连接正常';
      status.className = 'pill good';
      eventBus.emit('ws:connected');
    });

    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'snapshot') {
        this.appState = payload.state;
        // 发布事件而非直接调用其他模块
        eventBus.emit(Events.STATE_LOADED, {
          state: this.appState,
          songs: this.songs
        });
        this.scheduleSongReload();
      }
    });

    this.ws.addEventListener('close', () => {
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
    await this.reloadSongs();
  }

  /**
   * 重新加载应用状态
   */
  async reloadState() {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '读取状态失败');

    this.appState = payload.data;
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
  async reloadSongs() {
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
    await this.reloadState();

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
      this.reloadSongs().catch(showError);
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
