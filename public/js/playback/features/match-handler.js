// 编写人：Aurora
// 匹配测试处理模块
'use strict';

/**
 * 创建匹配测试处理模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 匹配测试函数集合
 */
export function createMatchHandler(deps) {
  const { matchService, showError, value, renderPlaybackMatchResults } = deps;
  let generation = 0;

  /**
   * 执行匹配测试
   */
  async function runPlaybackMatchTest() {
    const request = ++generation;
    const resultNode = document.getElementById('playbackMatchResults');
    const songName = value('playbackMatchSong');

    if (resultNode) resultNode.textContent = '正在匹配...';

    try {
      const artist = value('playbackMatchArtist');
      const durationMs = Number(value('playbackMatchDuration') || 0);
      const data = await matchService.testMatch(songName, artist, durationMs, { isCurrent: () => request === generation });
      if (request === generation) renderPlaybackMatchResults(data);
    } catch (error) {
      if (request !== generation) return;
      if (resultNode) resultNode.textContent = error.message || String(error);
      showError(error);
    }
  }

  return {
    runPlaybackMatchTest,
  };
}
