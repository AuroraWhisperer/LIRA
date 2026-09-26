// 编写人：Aurora
// 缓存管理器 - 对"我喜欢"和"歌单"类数据做跨启动 localStorage 缓存
// 命中后由 ContentLoader 后台刷新，兼顾启动速度和数据新鲜度
'use strict';

const CACHE_PREFIX = 'playbackCache:v2:';

/** 缓存有效期（毫秒） */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MEMORY_ENTRIES = 64;
const MAX_MEMORY_BYTES = 8 * 1024 * 1024;

/**
 * 缓存管理器
 * - 内存层：当前页面生命周期内最快访问
 * - localStorage 层：页面刷新不丢缓存
 * - 账号登录态变化时由调用方清理对应平台缓存
 */
export class CacheManager {
  constructor() {
    /** @type {Map<string, {data: any, timestamp: number}>} */
    this._mem = new Map();
  }

  /**
   * 读取缓存（内存优先 → localStorage）
   * @param {string} key - 缓存键
   * @param {number} [ttlMs] - 有效期，默认 24 小时
   * @returns {any|null} 缓存数据，过期或不存在返回 null
   */
  get(key, ttlMs) {
    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;

    // 1) 内存缓存
    const memEntry = this._mem.get(key);
    if (memEntry) {
      if (Date.now() - memEntry.timestamp < ttl) {
        this._mem.delete(key);
        this._mem.set(key, memEntry);
        return memEntry.data;
      }
      this._mem.delete(key);
    }

    // 2) localStorage 缓存
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || typeof entry.timestamp !== 'number') return null;
      if (Date.now() - entry.timestamp < ttl) {
        // 回填内存
        this._remember(key, entry.data, entry.timestamp, raw.length * 2);
        return entry.data;
      }
      // 过期则清理
      localStorage.removeItem(CACHE_PREFIX + key);
    } catch (_) {
      return null;
    }

    return null;
  }

  /**
   * 写入缓存（同时写内存和 localStorage）
   * @param {string} key - 缓存键
   * @param {any} data - 要缓存的数据
   */
  set(key, data) {
    if (data === null || data === undefined) return;

    const timestamp = Date.now();

    try {
      const raw = JSON.stringify({ data, timestamp });
      if (!this._remember(key, data, timestamp, raw.length * 2)) {
        this.remove(key);
        return;
      }
      localStorage.setItem(CACHE_PREFIX + key, raw);
    } catch (error) {
      // localStorage 满了就只保留内存缓存，不影响功能
      console.warn('[CacheManager] localStorage write failed:', error.message);
    }
  }

  _remember(key, data, timestamp, bytes) {
    this._mem.delete(key);
    const cutoff = Date.now() - DEFAULT_TTL_MS;
    let retainedBytes = 0;
    for (const [existingKey, entry] of this._mem) {
      if (entry.timestamp <= cutoff) this.remove(existingKey);
      else retainedBytes += entry.bytes;
    }
    if (bytes > MAX_MEMORY_BYTES) return false;
    while (this._mem.size >= MAX_MEMORY_ENTRIES || retainedBytes + bytes > MAX_MEMORY_BYTES) {
      const oldest = this._mem.keys().next().value;
      retainedBytes -= this._mem.get(oldest).bytes;
      this._mem.delete(oldest);
    }
    this._mem.set(key, { data, timestamp, bytes });
    return true;
  }

  /**
   * 删除指定缓存
   * @param {string} key
   */
  remove(key) {
    this._mem.delete(key);
    try {
      localStorage.removeItem(CACHE_PREFIX + key);
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * 按前缀清缓存
   * @param {string} prefix
   */
  clearByPrefix(prefix) {
    // 内存
    for (const key of this._mem.keys()) {
      if (key.startsWith(prefix)) this._mem.delete(key);
    }

    // localStorage
    try {
      const fullPrefix = CACHE_PREFIX + prefix;
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(fullPrefix)) keysToRemove.push(k);
      }
      for (const k of keysToRemove) localStorage.removeItem(k);
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * 清空所有播放缓存
   */
  clearAll() {
    this._mem.clear();
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) keysToRemove.push(k);
      }
      for (const k of keysToRemove) localStorage.removeItem(k);
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * 检查缓存是否存在且未过期
   * @param {string} key
   * @param {number} [ttlMs]
   * @returns {boolean}
   */
  has(key, ttlMs) {
    return this.get(key, ttlMs) !== null;
  }

  /**
   * 构建标准缓存键
   * @param {string} platform - 平台 (netease|qq)
   * @param {string} category - 类别 (liked|created-playlists|collected-playlists|playlist-tracks)
   * @param {string} [id] - 可选标识（如歌单 ID）
   * @returns {string}
   */
  static key(platform, category, id = '') {
    const base = `${platform}:${category}`;
    return id ? `${base}:${id}` : base;
  }
}
