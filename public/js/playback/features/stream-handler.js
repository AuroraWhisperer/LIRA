// 编写人：Aurora
// 流媒体处理模块
'use strict';

export function createStreamHandler(deps) {
  const { streamService, showError, playbackState } = deps;

  async function getPlaybackTrackUrl(track, options = {}) {
    return await streamService.getTrackUrl(track, options);
  }

  async function handlePlaybackError(audio, playPlaybackTrack) {
    const track = playbackState.current;

    await streamService.handlePlaybackError(
      track,
      audio,
      (track, resumeAt) => {
        // 重试成功回调
        playPlaybackTrack(track, {
          origin: playbackState.currentOrigin,
          forceRefresh: true,
          isRetry: true,
          startAt: resumeAt
        });
      },
      (playbackNext) => {
        // 重试失败回调
        playbackNext(false);
      }
    );
  }

  return {
    getPlaybackTrackUrl,
    handlePlaybackError
  };
}
