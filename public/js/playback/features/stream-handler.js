// 编写人：Aurora
// 流媒体处理模块
'use strict';

export function createStreamHandler(deps) {
  const {
    streamService,
    playbackState,
    getPlaybackAudio,
    playPlaybackTrack,
    playbackNext,
  } = deps;

  async function getPlaybackTrackUrl(track, options = {}) {
    return await streamService.getTrackUrl(track, options);
  }

  async function handlePlaybackError() {
    const track = playbackState.current;
    const audio = getPlaybackAudio();

    await streamService.handlePlaybackError(
      track,
      audio,
      (track, resumeAt) => {
        // 重试成功回调
        playPlaybackTrack(track, {
          origin: playbackState.currentOrigin,
          isRetry: true,
          startAt: resumeAt,
        });
      },
      () => {
        // 重试失败回调
        return playbackNext(false);
      },
    );
  }

  return {
    getPlaybackTrackUrl,
    handlePlaybackError,
  };
}
