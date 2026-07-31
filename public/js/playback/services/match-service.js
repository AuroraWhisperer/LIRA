// 编写人：Aurora
// 点歌匹配服务 - 负责点歌请求的自动匹配和待确认管理
'use strict';

import * as PlaybackUtils from '../utils.js';

/**
 * 点歌匹配服务类
 */
export class MatchService {
  constructor(options = {}) {
    this.state = options.state || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.toast = options.toast || (() => {});
  }

  /**
   * 为点歌队列项匹配曲目
   * @param {Object} item - 点歌队列项
   * @param {Array} platforms - 平台列表（优先级顺序）
   * @returns {Promise<Object|null>} 匹配结果 {autoAccept, score, reasons, track}
   */
  async matchQueueItem(item, platforms = []) {
    const songName = item.song_name || item.songName || '';
    const artist = item.artist || '';

    if (!songName) return null;

    let fallbackMatch = null;

    for (const platform of platforms) {
      try {
        const matched = await this.matchOnPlatform(item, platform);
        if (!matched) continue;

        // 找到可自动接受的匹配，直接返回
        if (matched.autoAccept) {
          return matched;
        }

        // 保留最高分的匹配作为备选
        if (!fallbackMatch || matched.score > fallbackMatch.score) {
          fallbackMatch = matched;
        }
      } catch (error) {
        console.warn('[MatchService] match failed on platform:', platform, error.message || error);
      }
    }

    return fallbackMatch;
  }

  /**
   * 在指定平台上匹配曲目
   * @param {Object} item - 点歌队列项
   * @param {string} platform - 平台名称
   * @returns {Promise<Object|null>} 匹配结果
   */
  async matchOnPlatform(item, platform) {
    const songName = item.song_name || item.songName || '';
    const artist = item.artist || '';

    // 第一步：搜索候选曲目
    const searchResponse = await fetch('/api/music/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        keyword: artist ? `${songName} ${artist}` : songName,
        limit: 10
      })
    });

    const searchPayload = await this.readJsonResponse(searchResponse, '搜索点歌候选失败');
    if (!searchResponse.ok || !searchPayload.ok) return null;

    const candidates = Array.isArray(searchPayload.data && searchPayload.data.tracks)
      ? searchPayload.data.tracks
      : [];

    if (!candidates.length) return null;

    // 第二步：调用匹配接口
    const matchResponse = await fetch('/api/music/match-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songName, artist, candidates })
    });

    const matchPayload = await this.readJsonResponse(matchResponse, '点歌匹配失败');
    if (!matchResponse.ok || !matchPayload.ok) return null;

    const best = matchPayload.data && Array.isArray(matchPayload.data.results)
      ? matchPayload.data.results[0]
      : null;

    if (!best || !best.track) return null;

    return {
      autoAccept: Boolean(best.autoAccept),
      score: Number(best.score || 0),
      reasons: Array.isArray(best.reasons) ? best.reasons : [],
      track: PlaybackUtils.normalizeOnlineTrack(best.track)
    };
  }

  /**
   * 测试匹配功能
   * @param {string} songName - 歌曲名
   * @param {string} artist - 歌手名（可选）
   * @param {number} durationMs - 时长（可选）
   * @returns {Promise<Object>} 匹配结果
   */
  async testMatch(songName, artist = '', durationMs = 0) {
    if (!songName) {
      throw new Error('请输入要测试的歌名');
    }

    const response = await fetch('/api/music/match-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songName,
        artist,
        durationMs: Number(durationMs || 0)
      })
    });

    const payload = await this.readJsonResponse(response, '点歌匹配测试失败');

    if (!payload.ok) {
      throw new Error(payload.error || '点歌匹配测试失败');
    }

    return payload.data;
  }

  /**
   * 添加待确认请求
   * @param {Object} item - 点歌队列项
   * @param {Object} matched - 匹配结果
   */
  addPendingRequest(item, matched) {
    if (!this.state || !matched || !matched.track) return;

    const pendingRequest = {
      id: `pending:${item.id || Date.now()}:${matched.track.id}`,
      songName: item.song_name || item.songName || '',
      artist: item.artist || '',
      requesterName: item.requester_name || item.requesterName || '观众',
      score: matched.score,
      reasons: matched.reasons,
      track: matched.track
    };

    this.state.pendingRequests.push(pendingRequest);
  }

  /**
   * 确认待确认请求
   * @param {number} index - 索引
   * @returns {Object|null} 确认的曲目
   */
  confirmPendingRequest(index) {
    if (!this.state) return null;
    if (!Number.isInteger(index) || index < 0 || index >= this.state.pendingRequests.length) {
      return null;
    }

    const [item] = this.state.pendingRequests.splice(index, 1);
    if (!item || !item.track) return null;

    return {
      ...item.track,
      requestedBy: item.requesterName || '观众'
    };
  }

  /**
   * 忽略待确认请求
   * @param {number} index - 索引
   * @returns {boolean} 是否成功
   */
  ignorePendingRequest(index) {
    if (!this.state) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.state.pendingRequests.length) {
      return false;
    }

    this.state.pendingRequests.splice(index, 1);
    return true;
  }

  /**
   * 获取待确认请求列表
   * @returns {Array}
   */
  getPendingRequests() {
    if (!this.state) return [];
    return this.state.pendingRequests || [];
  }

  /**
   * 清空待确认请求
   */
  clearPendingRequests() {
    if (!this.state) return;
    this.state.pendingRequests = [];
  }
}
