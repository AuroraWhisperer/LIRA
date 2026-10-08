// 编写人：Aurora
// 导入处理模块
'use strict';

import * as PlaybackUtils from '../utils.js';
import { createPlaybackStateActions } from '../state/actions.js';

/**
 * 创建导入处理模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 导入处理函数集合
 */
export function createImportHandler(deps) {
  const { playbackState, importService, showError, toast } = deps;
  const stateActions = deps.stateActions || createPlaybackStateActions(playbackState);
  let importing = false;

  /**
   * 从点歌队列导入歌曲
   * @param {Object} callbacks - 队列操作回调
   * @param {Function} callbacks.insertPlaybackTracksNext - 插队
   * @param {Function} callbacks.savePlaybackState - 保存状态
   * @param {Function} callbacks.renderPlayback - 重新渲染
   */
  async function importSongQueueToPlayback(callbacks) {
    if (importing) return;
    importing = true;
    const button = document.getElementById('playbackImportSongQueue');
    if (button) button.disabled = true;

    try {
      const currentSource = playbackState.current && playbackState.current.source;
      const platforms = PlaybackUtils.preferredPlatforms(currentSource, playbackState.selectedSource);
      const result = await importService.importFromSongQueue({
        maxItems: 30,
        platforms: platforms,
        importedRequestKeys: playbackState.importedSongRequestKeys,
      });

      if (result.tracks.length > 0) {
        callbacks.insertPlaybackTracksNext(result.tracks);
      }
      stateActions.setImportedSongRequestKeys(result.importedRequestKeys);
      callbacks.savePlaybackState();
      callbacks.renderPlayback();

      toast(`已导入 ${result.imported} 首，待确认 ${result.pending} 首，跳过 ${result.skipped} 首`);
    } catch (error) {
      showError(error);
    } finally {
      importing = false;
      if (button) button.disabled = false;
    }
  }

  return {
    importSongQueueToPlayback,
  };
}
