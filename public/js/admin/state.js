// 编写人：Aurora
// 全局状态管理和数据加载
'use strict';

import { showError } from '../shared/utils.js';
import { eventBus, Events } from '../shared/event-bus.js';

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
    this.songReloadVersion = 0;
    this.readSongFilters = () => ({});
    this.stateReloadVersion = 0;
    this.pendingStateReload = null;
    this.realtimeVersion = 0;
    this.realtimeFields = new Map();
    this.shuttingDown = false;
    this.songLanguages = new Set();
    this.songArtists = new Set();
    this.songTags = new Set();
    this.ws = null;
    this.hasConnected = false;
    this.reconnectTimer = null;
    this.lyricVersion = { generation: null, sequence: 0 };
    this.giftCatalogVersion = '';
  }

  /**
   * 连接WebSocket
   */
  connectSocket() {
    if (this.shuttingDown || this.ws || this.reconnectTimer !== null) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = window.__API_TOKEN__;
    const wsUrl = `${protocol}//${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
    this.ws = new WebSocket(wsUrl);
    const connection = this.ws;

    this.ws.addEventListener('open', () => {
      if (this.ws !== connection || this.shuttingDown) return;
      if (this.hasConnected) this.scheduleSongReload();
      this.hasConnected = true;
      eventBus.emit('ws:connected');
    });

    this.ws.addEventListener('message', (event) => {
      if (this.ws !== connection || this.shuttingDown) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (!isRecord(payload)) return;
      if (payload.type === 'snapshot') {
        if (!isStateSnapshot(payload.state)) return;
        this.realtimeVersion += 1;
        for (const key of Object.keys(payload.state)) {
          this.realtimeFields.set(key, this.realtimeVersion);
        }
        this.applySnapshot(payload.state, Infinity, payload.reason === 'connect');
        if (isGiftSnapshotReason(payload.reason)) {
          eventBus.emit(Events.GIFT_RECEIVED, { reason: payload.reason });
        }
        if (isSongsSnapshotReason(payload.reason)) {
          this.scheduleSongReload();
        }
      } else if (payload.type === 'overtime:update') {
        if (!isRecord(payload.state)) return;
        const currentRevision = Number(this.appState?.overtime?.revision) || 0;
        const nextRevision = Number(payload.state?.revision) || 0;
        if (nextRevision <= currentRevision) return;
        this.applyRealtimeField('overtime', payload.state);
        eventBus.emit(Events.OVERTIME_UPDATED, payload);
      } else if (payload.type === 'gift-catalog:update') {
        const snapshot = payload.snapshot;
        if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.gifts)) return;
        const version = String(snapshot.version || '').trim();
        // A catalog update without a revision cannot be safely ordered or
        // deduplicated. Ignore malformed wire messages instead of replacing a
        // usable picker state with an anonymous payload.
        if (!version) return;
        // A catalog revision can keep the same version while its freshness
        // metadata changes (for example, crossing the server's stale cutoff).
        // Deduplicate the full observable signature instead of dropping those
        // updates based on version alone.
        const signature = JSON.stringify({
          version,
          updatedAt: String(snapshot.updatedAt || snapshot.refreshedAt || ''),
          assetsUpdatedAt: String(snapshot.assetsUpdatedAt || ''),
          stale: parseBooleanLike(snapshot.stale),
          sources: snapshot.sources || null,
          gifts: snapshot.gifts.map((gift) => [String(gift?.id ?? '').trim(), String(gift?.imagePath ?? '').trim()]),
        });
        if (signature === this.giftCatalogVersion) return;
        this.giftCatalogVersion = signature;
        eventBus.emit(Events.GIFT_CATALOG_UPDATED, { snapshot });
      } else if (payload.type === 'wesing-state') {
        if (payload.state !== null && !isRecord(payload.state)) return;
        this.applyRealtimeField('weSing', payload.state);
        dispatchRealtimeState('app:wesing-state', payload.state);
      } else if (payload.type === 'lyric-state') {
        if (!this.acceptLyricState(payload.state)) return;
        this.applyRealtimeField('lyricState', payload.state);
        dispatchRealtimeState('app:lyric-state', payload.state);
      } else if (payload.type === 'lyric-timeline') {
        if (payload.timeline !== null && !isRecord(payload.timeline)) return;
        this.applyRealtimeField('lyricTimeline', payload.timeline);
        dispatchRealtimeState('app:lyric-timeline', payload.timeline);
      } else if (payload.type === 'game:update') {
        dispatchRealtimeState('app:game-update', payload.session, true);
      } else if (payload.type === 'game:patch' && payload.state) {
        dispatchRealtimeState('app:game-patch', payload, true);
      } else if (payload.type === 'interaction:update') {
        dispatchRealtimeState('app:interaction-update', payload.state, true);
      } else if (payload.type === 'wheel:update') {
        dispatchRealtimeState('app:wheel-update', payload.state, true);
      }
    });

    this.ws.addEventListener('close', () => {
      if (this.ws !== connection) return;
      this.ws = null;
      if (this.shuttingDown) {
        eventBus.emit('app:shutdown');
        return;
      }
      eventBus.emit('ws:disconnected');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connectSocket();
      }, 1600);
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
  reloadState() {
    const requestVersion = ++this.stateReloadVersion;
    const startedAtVersion = this.realtimeVersion;
    this.pendingStateReload = (async () => {
      const response = await fetch('/api/state');
      const payload = await response.json();
      if (requestVersion !== this.stateReloadVersion) return this.pendingStateReload;
      if (!payload?.ok) throw new Error(payload?.error || '读取状态失败');
      if (!isStateSnapshot(payload.data)) throw new Error('读取状态失败：数据格式错误');
      this.applySnapshot(payload.data, startedAtVersion);
      return this.appState;
    })();
    return this.pendingStateReload;
  }

  applyRealtimeField(key, state) {
    this.realtimeFields.set(key, ++this.realtimeVersion);
    this.appState = this.appState || {};
    this.appState[key] = state;
  }

  applySnapshot(snapshot, startedAtVersion = Infinity, isConnectionSnapshot = false) {
    if (!isStateSnapshot(snapshot)) return;
    const previous = this.appState || {};
    const next = { ...snapshot };
    // HTTP hydrates untouched fields but cannot undo realtime work received
    // after that request started, including partial lyric/WeSing updates.
    for (const [key, version] of this.realtimeFields) {
      if (version > startedAtVersion) next[key] = previous[key];
    }
    if (!this.acceptLyricState(next.lyricState) && previous.lyricState) {
      next.lyricState = previous.lyricState;
    }
    if (
      !isConnectionSnapshot &&
      previous.overtime &&
      Number(next.overtime?.revision) <= Number(previous.overtime.revision)
    ) {
      next.overtime = previous.overtime;
    }
    const changedKeys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
      (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
    );
    this.appState = next;
    if (changedKeys.includes('categories')) this.categories = next.categories || [];
    if (changedKeys.includes('tags')) this.songTags = new Set(next.tags || []);
    for (const [key, eventName] of [
      ['settings', 'app:settings-state'],
      ['weSing', 'app:wesing-state'],
      ['lyricState', 'app:lyric-state'],
      ['lyricTimeline', 'app:lyric-timeline'],
    ]) {
      if (changedKeys.includes(key)) dispatchRealtimeState(eventName, next[key]);
    }
    if (!changedKeys.length) return;
    eventBus.emit(Events.STATE_LOADED, {
      state: this.appState,
      songs: this.songs,
      changedKeys,
      isConnectionSnapshot,
    });
  }

  /**
   * 由歌库页面提供当前筛选，供手动刷新、实时失效和重连共用。
   */
  setSongFiltersReader(readFilters) {
    this.readSongFilters = readFilters;
  }

  /**
   * 重新加载歌曲列表
   */
  async reloadSongs(options = {}) {
    const requestVersion = ++this.songReloadVersion;
    const filters = options.filters ?? this.readSongFilters();
    const params = new URLSearchParams();
    if (filters.query) params.set('query', filters.query);
    for (const category of filters.categories || []) {
      params.append('category', category);
    }
    if (filters.language) params.set('language', filters.language);
    if (filters.artist) params.set('artist', filters.artist);
    for (const tag of filters.tags || []) {
      params.append('tag', tag);
    }
    if (filters.enabledOnly === true) params.set('enabledOnly', 'true');

    const response = await fetch(`/api/songs?${params}`);
    const payload = await response.json();
    // 只接纳最新请求，避免旧筛选结果覆盖当前列表。
    if (requestVersion !== this.songReloadVersion) return;
    if (!payload.ok) throw new Error(payload.error || '读取歌库失败');

    this.songs = payload.data || [];
    if (options.reloadState !== false) {
      await this.reloadState();
    }
    if (requestVersion !== this.songReloadVersion) return;

    // 发布歌曲更新事件
    eventBus.emit(Events.SONG_UPDATED, {
      songs: this.songs,
      languages: this.songLanguages,
      artists: this.songArtists,
      tags: this.songTags,
    });
  }

  /**
   * 延迟重新加载歌曲
   */
  scheduleSongReload() {
    if (this.shuttingDown) return;
    clearTimeout(this.songReloadTimer);
    this.songReloadTimer = setTimeout(() => {
      this.songReloadTimer = null;
      if (this.shuttingDown) return;
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
    if (value) {
      clearTimeout(this.songReloadTimer);
      this.songReloadTimer = null;
    }
    if (value && this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  acceptLyricState(state) {
    if (!isRecord(state)) return false;
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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStateSnapshot(value) {
  return isRecord(value) && ['categories', 'tags'].every((key) => value[key] == null || Array.isArray(value[key]));
}

function parseBooleanLike(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function dispatchRealtimeState(eventName, state, allowEmpty = false) {
  if ((!state && !allowEmpty) || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: state }));
}

function isGiftSnapshotReason(reason) {
  return (
    reason === 'bilibili:gift' ||
    reason === 'gift:clear-recent' ||
    reason === 'database:clear-gifts' ||
    reason === 'database:clear-all'
  );
}

function isSongsSnapshotReason(reason) {
  const snapshotReason = String(reason || '');
  return snapshotReason === 'cloud:songs' || snapshotReason.startsWith('songs:');
}

// 创建单例实例
export const stateService = new StateService();
