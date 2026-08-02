// 编写人：Aurora
// 歌词控制模块
'use strict';

/**
 * 创建歌词控制模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 歌词控制函数集合
 */
export function createLyricControls(deps) {
  const {
    playbackState,
    lyricService,
    renderPlayback
  } = deps;

  /**
   * 同步歌词窗口
   * @param {boolean} force - 是否强制更新
   * @param {Function} getPlaybackAudio - 获取音频元素的函数
   */
  async function syncPlaybackLyricWindow(force = false, getPlaybackAudio) {
    const audio = getPlaybackAudio();
    const track = playbackState.current || null;
    const changed = await lyricService.syncWindow(track, audio, force);
    if (changed) renderPlayback();
  }

  return {
    syncPlaybackLyricWindow
  };
}
