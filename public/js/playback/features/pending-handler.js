// 编写人：Aurora
// 待确认操作处理模块
'use strict';

/**
 * 创建待确认操作处理模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 待确认操作函数集合
 */
export function createPendingHandler(deps) {
  const {
    playbackState,
    savePlaybackState,
    renderPlayback
  } = deps;

  /**
   * 处理待确认操作（确认/忽略）
   * @param {string} action - 'confirm' 或 'ignore'
   * @param {number} index - 待确认请求的索引
   * @param {Function} playPlaybackTrack - 播放轨道的函数
   */
  function handlePlaybackPendingAction(action, index, playPlaybackTrack) {
    const pending = playbackState.pendingRequests[index];
    if (!pending) return;

    if (action === 'confirm') {
      playbackState.pendingRequests.splice(index, 1);
      const track = pending.track;
      if (track) {
        playPlaybackTrack(track, { origin: 'requested', requestedBy: pending.requesterName });
      }
    } else if (action === 'ignore') {
      playbackState.pendingRequests.splice(index, 1);
    }

    savePlaybackState();
    renderPlayback();
  }

  return {
    handlePlaybackPendingAction
  };
}
