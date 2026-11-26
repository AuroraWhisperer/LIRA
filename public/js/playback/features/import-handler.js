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
  let activeImport = null;

  function setImporting(importing) {
    for (const id of ['playbackImportSongQueue', 'songQueueImportPlayback']) {
      const button = document.getElementById(id);
      if (!button) continue;
      if (importing) button.dataset.importing = 'true';
      else delete button.dataset.importing;
      button.disabled = importing || playbackState.selectedSource === 'wesing';
    }
  }

  function invalidateImports() {
    if (!activeImport) return;
    activeImport.abort();
    activeImport = null;
    setImporting(false);
  }

  /**
   * 从点歌队列导入歌曲
   * @param {Object} callbacks - 队列操作回调
   * @param {Function} callbacks.insertPlaybackTracksNext - 插队
   * @param {Function} callbacks.savePlaybackState - 保存状态
   * @param {Function} callbacks.renderPlayback - 重新渲染
   */
  async function importSongQueueToPlayback(callbacks) {
    if (activeImport || playbackState.selectedSource === 'wesing') return;
    const controller = new AbortController();
    activeImport = controller;
    const isCurrent = () => activeImport === controller;
    setImporting(true);

    try {
      callbacks.renderPlayback();
      const currentSource = playbackState.current && playbackState.current.source;
      const platforms = PlaybackUtils.preferredPlatforms(currentSource, playbackState.selectedSource);
      const result = await importService.importFromSongQueue({
        maxItems: 30,
        platforms: platforms,
        importedRequestKeys: playbackState.importedSongRequestKeys,
        isCurrent,
        signal: controller.signal,
      });

      if (!isCurrent()) return;
      if (result.tracks.length > 0) {
        callbacks.insertPlaybackTracksNext(result.tracks);
      }
      stateActions.setImportedSongRequestKeys(result.importedRequestKeys);
      callbacks.savePlaybackState();

      toast(result.empty ? '点歌队列为空' : `已导入 ${result.imported} 首，待确认 ${result.pending} 首，跳过 ${result.skipped} 首`);
    } catch (error) {
      if (isCurrent()) showError(error.name === 'TimeoutError'
        ? new Error('读取点歌队列超时，请稍后重试') : error);
    } finally {
      if (isCurrent()) {
        activeImport = null;
        setImporting(false);
        callbacks.renderPlayback();
      }
    }
  }

  return {
    importSongQueueToPlayback,
    invalidateImports,
  };
}
