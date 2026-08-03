// 编写人：Aurora
// 播放控制模块
'use strict';

import * as PlaybackUtils from '../utils.js';

function isInterruptedMediaPlayError(error) {
  return error?.name === 'AbortError'
    || /play\(\) request was interrupted/i.test(String(error?.message || error || ''));
}

export function createPlaybackControls(deps) {
  const {
    playbackState,
    getPlaybackAudio,
    showError,
    toast,
    lyricService,
    localFileManager,
    streamService,
    savePlaybackState,
    renderPlayback,
    updatePlaybackMediaSession,
    syncPlaybackLyricWindow,
    U
  } = deps;
  let playRequestGeneration = 0;

  async function ensureLocalTrackPlayable(track) {
    if (!PlaybackUtils.isLocalTrack(track)) return true;
    if (track.objectUrl) {
      track.fileMissing = false;
      return true;
    }

    // Try IPC restore from saved filePath
    if (track.filePath && window.musicAPI && typeof window.musicAPI.resolveLocalMediaUrls === 'function') {
      try {
        const res = await window.musicAPI.resolveLocalMediaUrls([track.filePath]);
        const entry = res && res.results && res.results[track.filePath];
        if (entry && entry.ok) {
          track.objectUrl = entry.url;
          track.fileMissing = false;
          savePlaybackState();
          return true;
        }
      } catch (_) {}
    }

    // File missing: prompt re-selection
    toast('文件已移动或删除，请重新选择本地文件');
    try {
      const updated = await localFileManager.reselectLocalFile(track);
      if (updated && updated.objectUrl) {
        Object.assign(track, updated);
        track.fileMissing = false;
        savePlaybackState();
        renderPlayback();
        return true;
      }
    } catch (_) {}

    track.fileMissing = true;
    renderPlayback();
    return false;
  }

  async function playPlaybackTrack(track, options = {}) {
    const audio = getPlaybackAudio();
    if (!audio || !track) return;
    const requestGeneration = ++playRequestGeneration;

    // For local tracks, ensure the file is accessible before trying to play
    if (PlaybackUtils.isLocalTrack(track)) {
      const ok = await ensureLocalTrackPlayable(track);
      if (!ok) return;
    }

    if (requestGeneration !== playRequestGeneration) return;

    let streamUrl = '';
    try {
      streamUrl = await streamService.getTrackUrl(track, {
        forceRefresh: options.forceRefresh === true
      });
    } catch (error) {
      if (requestGeneration !== playRequestGeneration) return;
      showError(error);
      renderPlayback();
      return;
    }
    if (requestGeneration !== playRequestGeneration) return;
    if (!streamUrl) {
      playbackState.current = track;
      playbackState.currentOrigin = options.origin || playbackState.currentOrigin || 'normal';
      renderPlayback();
      return;
    }

    if (!options.isRetry) streamService.resetRetryCount();
    if (playbackState.current && playbackState.current.id !== track.id && !options.fromHistory) {
      playbackState.history.push(playbackState.current);
      playbackState.history = playbackState.history.slice(-50);
    }
    // 更新展示用播放历史（200首，去重，最新置顶）
    if (!options.fromHistory) {
      playbackState.displayHistory = [
        { ...track, playedAt: Date.now() },
        ...playbackState.displayHistory.filter((t) => t.id !== track.id)
      ].slice(0, 200);
    }

    playbackState.current = track;
    playbackState.currentOrigin = options.origin || playbackState.currentOrigin || 'normal';
    audio.dataset.trackId = track.id;
    audio.src = streamUrl;
    audio.load();

    const startAt = Math.max(0, Number(options.startAt || 0));
    if (startAt > 0) {
      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 1));
        }
      }, { once: true });
    }

    try {
      await audio.play();
      if (startAt > 0) {
        const dur = audio.duration;
        if (Number.isFinite(dur) && dur > 0) {
          audio.currentTime = Math.min(startAt, Math.max(0, dur - 1));
        }
      }
    } catch (error) {
      if (requestGeneration === playRequestGeneration && !isInterruptedMediaPlayError(error)) {
        showError(error);
      }
    }

    if (requestGeneration !== playRequestGeneration) return;

    playbackState.restoredTime = 0;

    loadPlaybackLyrics(track);
    savePlaybackState();
    renderPlayback();
    updatePlaybackMediaSession();
  }

  async function loadPlaybackLyrics(track) {
    if (!track) return;
    const lyrics = await lyricService.loadLyrics(track);
    if (lyrics && playbackState.current && playbackState.current.id === track.id) {
      playbackState.current.lyrics = lyrics;
      syncPlaybackLyricWindow(true);
    }
  }

  async function togglePlayback(takeNextPlaybackTrack, showPlaybackLoginPrompt) {
    const audio = getPlaybackAudio();
    if (!audio) return;

    if (!playbackState.current) {
      const next = takeNextPlaybackTrack();
      if (next) {
        playbackState.current = next.track;
        playbackState.currentOrigin = next.origin;
      }
    }

    const track = playbackState.current;
    if (!track) {
      const playbackAuthState = deps.playbackAuthState;
      if (!playbackAuthState || !playbackAuthState.loggedIn) {
        showPlaybackLoginPrompt();
      } else {
        if (typeof U.showStackedToast === 'function') {
          const sourceName = PlaybackUtils.getSourceName(playbackState.selectedSource);
          U.showStackedToast({
            key: 'playback-queue-empty',
            title: '播放队列为空',
            message: `搜索${sourceName}歌曲并添加到播放队列`,
            className: 'playback-empty-queue-toast',
            duration: 4200
          });
        } else {
          toast('播放队列为空，请先选择歌曲');
        }
      }
      return;
    }

    if (!audio.src || audio.dataset.trackId !== track.id) {
      await playPlaybackTrack(track, { origin: playbackState.currentOrigin, startAt: playbackState.restoredTime });
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        if (!isInterruptedMediaPlayError(error)) showError(error);
      }
    } else {
      audio.pause();
      savePlaybackState();
    }
    renderPlayback();
  }

  async function playbackPrevious() {
    const audio = getPlaybackAudio();
    if (!audio) return;
    if (audio.currentTime > 5) {
      audio.currentTime = 0;
      return;
    }
    const previousTrack = playbackState.history.pop();
    if (previousTrack) {
      await playPlaybackTrack(previousTrack, { fromHistory: true, origin: 'history' });
    }
  }

  function playbackNext(fromEnded, takeNextPlaybackTrack, ensurePlaybackRadioQueueFilled) {
    const audio = getPlaybackAudio();
    if (!audio) return;

    if (playbackState.mode === 'repeat-one' && playbackState.current) {
      playPlaybackTrack(playbackState.current, { origin: playbackState.currentOrigin });
      return;
    }

    const next = takeNextPlaybackTrack();
    if (next) {
      playPlaybackTrack(next.track, { origin: next.origin });
      if (playbackState.queueType === 'radio') ensurePlaybackRadioQueueFilled();
      return;
    }

    // 固定歌单按当前模式循环
    if (playbackState.queueType === 'playlist' && playbackState.normalQueueTracks.length > 0) {
      const tracks = playbackState.mode === 'shuffle'
        ? PlaybackUtils.shuffleTracks(playbackState.normalQueueTracks)
        : playbackState.normalQueueTracks.map((track) => ({ ...track }));
      const first = tracks[0];
      playbackState.normalQueue = tracks.slice(1);
      playbackState.playlistIndex = playbackState.normalQueueTracks.findIndex((track) => track.id === first.id);
      deps.rebuildPlaybackShuffleOrder();
      savePlaybackState();
      playPlaybackTrack(first, { origin: 'normal' });
      return;
    }

    if (fromEnded) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    renderPlayback();
    savePlaybackState();
    syncPlaybackLyricWindow();
    if (playbackState.queueType === 'radio') ensurePlaybackRadioQueueFilled();
  }

  return {
    playPlaybackTrack,
    togglePlayback,
    playbackPrevious,
    playbackNext,
    loadPlaybackLyrics,
    ensureLocalTrackPlayable
  };
}
