// 编写人：Aurora
// 待确认操作处理模块
'use strict';

import { createPlaybackStateActions } from '../state/actions.js';

/**
 * 创建待确认操作处理模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 待确认操作函数集合
 */
export function createPendingHandler(deps) {
  const { playbackState, savePlaybackState, renderPlayback } = deps;
  const stateActions =
    deps.stateActions ||
    createPlaybackStateActions(playbackState, {
      save: savePlaybackState,
      render: renderPlayback,
    });

  /**
   * 处理待确认操作（确认/忽略）
   * @param {string} action - 'confirm' 或 'ignore'
   * @param {number} index - 待确认请求的索引
   * @param {Function} insertPlaybackTracksNext - 插入下一首的函数
   */
  function handlePlaybackPendingAction(action, index, insertPlaybackTracksNext) {
    const pending = playbackState.pendingRequests[index];
    if (!pending) return;

    if (action === 'confirm') {
      const track = pending.track;
      if (track) {
        insertPlaybackTracksNext([{
          ...track,
          songRequestKey: pending.songRequestKey || track.songRequestKey || '',
          requestedBy: pending.requesterName,
        }]);
      }
      stateActions.removePending(index);
    } else if (action === 'ignore') {
      stateActions.removePending(index);
    }

    stateActions.commit();
  }

  return {
    handlePlaybackPendingAction,
  };
}
