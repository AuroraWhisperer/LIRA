// 编写人：Aurora
// 搜索处理模块
'use strict';

import * as PlaybackUtils from '../utils.js';

/**
 * 创建搜索处理模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 搜索处理函数集合
 */
export function createSearchHandler(deps) {
  const {
    playbackState,
    searchService,
    value,
    toast,
    renderPlaybackSearchResults
  } = deps;

  /**
   * 执行搜索
   */
  async function runPlaybackSearch() {
    const keyword = value('playbackSearchKeyword');
    const resultNode = document.getElementById('playbackSearchResults');

    console.log('[SearchHandler] runPlaybackSearch called with keyword:', keyword);
    if (resultNode) resultNode.textContent = '正在搜索...';
    try {
      const limit = Number(value('playbackSearchLimit') || 9);
      await searchService.search(keyword, limit);
      console.log('[SearchHandler] search completed, results:', searchService.getResults());
      renderPlaybackSearchResults();
    } catch (error) {
      console.log('[SearchHandler] search error:', error);
      if (resultNode) resultNode.textContent = error.message || String(error);
    }
  }

  /**
   * 清除搜索
   */
  function clearPlaybackSearch() {
    const keywordInput = document.getElementById('playbackSearchKeyword');
    if (keywordInput) keywordInput.value = '';
    searchService.clearResults();
    renderPlaybackSearchResults();
  }

  /**
   * 处理搜索结果的交互操作
   * @param {string} action - 操作类型
   * @param {number} index - 结果索引
   * @param {Object} callbacks - 回调函数集合（见 searchCallbacks）
   */
  async function handlePlaybackSearchAction(action, index, callbacks) {
    const track = searchService.getResultByIndex(index);
    console.log('[SearchHandler] handlePlaybackSearchAction called:', { action, index, track: track?.id });
    if (!track) return;

    if (action === 'add-to-playlist') {
      void callbacks.addTrackToPlaylist(track);
      return;
    }

    const queuedTrack = PlaybackUtils.normalizeOnlineTrack(track);

    if (action === 'play') {
      console.log('[SearchHandler] Calling insertAndPlayPlaybackTrack with:', queuedTrack.id);
      await callbacks.insertAndPlayPlaybackTrack(queuedTrack);
      console.log('[SearchHandler] insertAndPlayPlaybackTrack completed');
      callbacks.renderPlayback();
      return;
    }

    if (action === 'requested') {
      callbacks.insertPlaybackTracksNext([{
        ...queuedTrack,
        requestedBy: '手动搜索'
      }]);
      toast('已插入当前歌曲之后');
    } else {
      callbacks.appendPlaybackTracks([queuedTrack]);
      callbacks.rebuildPlaybackShuffleOrder();
      toast('已加入当前队列');
    }

    callbacks.savePlaybackState();
    callbacks.renderPlayback();
  }

  return {
    runPlaybackSearch,
    clearPlaybackSearch,
    handlePlaybackSearchAction
  };
}
