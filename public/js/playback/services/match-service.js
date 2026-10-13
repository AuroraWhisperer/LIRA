// 编写人：Aurora
// 点歌匹配服务 - 负责点歌请求的自动匹配和待确认管理
'use strict';

import { createPlaybackStateActions } from '../state/actions.js';

import * as PlaybackUtils from '../utils.js';

/**
 * 点歌匹配服务类
 */
export class MatchService {
  constructor(options = {}) {
    this.state = options.state || null;
    this.stateActions = options.stateActions || createPlaybackStateActions(this.state);
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.toast = options.toast || (() => {});
  }

  /**
   * 为点歌队列项匹配曲目
   * @param {Object} item - 点歌队列项
   * @param {Array} platforms - 平台列表（优先级顺序）
   * @param {Function} [onAttempt] - 诊断观察回调，不参与匹配决策
   * @returns {Promise<Object|null>} 匹配结果 {autoAccept, score, reasons, track}
   */
  async matchQueueItem(item, platforms = [], onAttempt) {
    const songName = item.song_name || item.songName || '';

    if (!songName) return null;

    let fallbackMatch = null;

    for (const platform of platforms) {
      try {
        const matched = await this.matchOnPlatform(item, platform, onAttempt);
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
        onAttempt?.(null, { error: error.message || String(error) }, platform);
        console.warn('[MatchService] match failed on platform:', platform, error.message || error);
      }
    }

    return fallbackMatch;
  }

  /**
   * 在指定平台上匹配曲目
   * @param {Object} item - 点歌队列项
   * @param {string} platform - 平台名称
   * @param {Function} [onAttempt] - 诊断观察回调
   * @returns {Promise<Object|null>} 匹配结果
   */
  async matchOnPlatform(item, platform, onAttempt) {
    const data = await this.searchAndRank(item, platform);
    const best = data.results?.[0];
    if (!best?.track) {
      onAttempt?.(null, data, platform);
      return null;
    }

    const matched = {
      autoAccept: Boolean(best.autoAccept),
      score: Number(best.score || 0),
      reasons: Array.isArray(best.reasons) ? best.reasons : [],
      track: PlaybackUtils.normalizeOnlineTrack(best.track),
    };
    onAttempt?.(matched, data, platform);
    return matched;
  }

  async searchAndRank(item, platform) {
    const songName = item.song_name || item.songName || '';
    const artist = item.artist || '';

    // 第一步：搜索候选曲目
    const searchResponse = await fetch('/api/music/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        keyword: artist ? `${songName} ${artist}` : songName,
        limit: 10,
      }),
    });

    const searchPayload = await this.readJsonResponse(searchResponse, '搜索点歌候选失败');
    if (!searchResponse.ok || !searchPayload.ok) throw new Error(searchPayload.error || '搜索点歌候选失败');

    const candidates = Array.isArray(searchPayload.data && searchPayload.data.tracks) ? searchPayload.data.tracks : [];

    if (!candidates.length) return { results: [], emptyReason: '当前音乐平台没有搜到候选歌曲，请调整歌名或歌手后重试。' };

    // 第二步：调用匹配接口
    const matchResponse = await fetch('/api/music/match-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songName, artist, durationMs: Number(item.durationMs || 0), candidates }),
    });

    const matchPayload = await this.readJsonResponse(matchResponse, '点歌匹配失败');
    if (!matchResponse.ok || !matchPayload.ok) throw new Error(matchPayload.error || '点歌匹配失败');
    return matchPayload.data;
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

    const attempts = [];
    const platforms = PlaybackUtils.preferredPlatforms(this.state?.current?.source, this.state?.selectedSource || 'qq');
    const matched = await this.matchQueueItem({ songName, artist, durationMs }, platforms,
      (match, data, platform) => attempts.push({ match, data, platform }));
    const selected = matched && attempts.find((attempt) => attempt.match === matched);
    const platformName = (platform) => platform === 'qq' ? 'QQ 音乐' : '网易云音乐';
    const summary = `按点歌导入顺序查询：${attempts.map((attempt) => platformName(attempt.platform)).join(' → ')}。`
      + (selected ? `本次采用${platformName(selected.platform)}的匹配结果。` : '没有找到可用候选歌曲。');
    const failures = attempts.filter((attempt) => attempt.data.error)
      .map((attempt) => `${platformName(attempt.platform)}：${attempt.data.error}`);
    return { ...(selected?.data || { results: [] }), searchSummary: [summary, ...failures].join(' '),
      emptyReason: '没有搜到候选歌曲，请调整歌名或歌手，并检查音乐平台连接后重试。' };
  }

  /**
   * 添加待确认请求
   * @param {Object} item - 点歌队列项
   * @param {Object} matched - 匹配结果
   */
  addPendingRequest(item, matched) {
    if (!this.state || !matched || !matched.track) return;

    const songRequestKey = PlaybackUtils.getSongRequestKey(item);
    if (songRequestKey && this.state.pendingRequests.some((request) => request.songRequestKey === songRequestKey)) return;
    const pendingRequest = {
      id: `pending:${item.id || Date.now()}:${matched.track.id}`,
      songRequestKey,
      songName: item.song_name || item.songName || '',
      artist: item.artist || '',
      requesterName: item.requester_name || item.requesterName || '观众',
      score: matched.score,
      reasons: matched.reasons,
      track: matched.track,
    };

    this.stateActions.addPending(pendingRequest);
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

    const item = this.stateActions.removePending(index);
    if (!item || !item.track) return null;

    return {
      ...item.track,
      songRequestKey: item.songRequestKey || '',
      requestedBy: item.requesterName || '观众',
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

    this.stateActions.removePending(index);
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
    this.stateActions.clearPending();
  }
}
