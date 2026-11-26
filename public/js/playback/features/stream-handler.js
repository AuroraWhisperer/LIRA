// 编写人：Aurora
// 流媒体处理模块
'use strict';

export function createStreamHandler(deps) {
  const {
    streamService,
    playbackState,
    stateActions,
    getPlaybackAudio,
    createPlaybackRequestGuard,
    playPlaybackTrack,
    playbackNext,
  } = deps;

  async function handlePlaybackError() {
    const track = playbackState.current;
    const audio = getPlaybackAudio();
    if (!track) return;
    const isCurrent = createPlaybackRequestGuard(track);
    const origin = playbackState.currentOrigin;

    if (track.source === 'local' && audio.dataset.trackId === track.id && isCurrent()) {
      stateActions.forgetLocalFileUrl(track.objectUrl);
      delete audio.dataset.trackId;
    }

    await streamService.handlePlaybackError(
      { ...track },
      (track) => {
        // 重试成功回调
        return playPlaybackTrack(track, {
          origin,
          isRetry: true,
        });
      },
      () => {
        // 重试失败回调
        return playbackNext(false, { skipUnavailable: true });
      },
      isCurrent,
    );
  }

  return {
    handlePlaybackError,
  };
}
