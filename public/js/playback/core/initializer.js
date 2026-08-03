// 编写人：Aurora
// 初始化模块
'use strict';

import * as PlaybackUtils from '../utils.js';

export function createInitializer(deps) {
  const {
    playbackState,
    getPlaybackAudio,
    uiRenderer,
    playerController,
    storageManager,
    localFileManager,
    renderPlayback,
    renderPlaybackProgress,
    renderFullscreenPlayer,
    savePlaybackState,
    syncPlaybackLyricWindow,
    updatePlaybackMediaSession,
    playbackNext,
    handlePlaybackError,
    flushPlaybackStateOnUnload,
    flushPlaybackStateForShutdown,
    refreshSelectedMusicProviderState
  } = deps;

  let playbackInitialized = false;

  async function init(setupEventHandlers, restorePlaybackState, refreshPlaybackMusicCacheStats) {
    if (playbackInitialized) return;
    playbackInitialized = true;

    const audio = getPlaybackAudio();
    if (!audio) {
      playbackInitialized = false;
      return;
    }

    // 初始化 UI 渲染器
    uiRenderer.init();

    // 设置播放器控制器的音频元素
    playerController.setAudio(audio);

    // 设置全屏播放器 seek 回调
    uiRenderer.getFullscreenPlayer().setSeekCallback(() => {
      renderPlaybackProgress();
      savePlaybackState();
    });

    await restorePlaybackState();
    audio.volume = playbackState.volume;

    // 设置所有事件监听器
    setupEventHandlers();

    // 设置音频元素事件监听器
    setupAudioEventListeners(audio);

    renderPlayback();
    void refreshSelectedMusicProviderState();
    refreshPlaybackMusicCacheStats();
  }

  function setupAudioEventListeners(audio) {
    audio.addEventListener('loadedmetadata', () => {
      const track = playbackState.current;
      if (track && Number.isFinite(audio.duration)) {
        track.durationMs = Math.round(audio.duration * 1000);
      }
      renderPlayback();
      savePlaybackState();
      syncPlaybackLyricWindow();
    });

    audio.addEventListener('timeupdate', () => {
      renderPlaybackProgress();
      savePlaybackState();
      syncPlaybackLyricWindow();
      renderFullscreenPlayer();
    });

    audio.addEventListener('play', () => {
      renderPlayback();
      updatePlaybackMediaSession();
      syncPlaybackLyricWindow();
    });

    audio.addEventListener('pause', () => {
      renderPlayback();
      updatePlaybackMediaSession();
      syncPlaybackLyricWindow();
      savePlaybackState();
    });

    audio.addEventListener('ended', () => playbackNext(true));
    audio.addEventListener('error', () => handlePlaybackError());

    window.addEventListener('pagehide', flushPlaybackStateOnUnload);

    // Electron prepare-shutdown: flush playback state via IPC before server closes
    if (window.musicAPI && typeof window.musicAPI.onPrepareShutdown === 'function') {
      window.musicAPI.onPrepareShutdown(async () => {
        try {
          await flushPlaybackStateForShutdown();
        } catch (error) {
          console.warn('[Playback] Shutdown state flush failed:', error.message || error);
        } finally {
          try {
            await window.musicAPI.confirmShutdownFlush();
          } catch (_) {}
        }
      });
    }
  }

  async function restoreLocalFileUrls() {
    const localTracks = [];
    const collect = function (t) {
      if (t && t.source === 'local' && !t.objectUrl && t.filePath) localTracks.push(t);
    };
    collect(playbackState.current);
    (playbackState.requestedQueue || []).forEach(collect);
    (playbackState.normalQueue || []).forEach(collect);
    (playbackState.normalQueueTracks || []).forEach(collect);
    (playbackState.radioQueue || []).forEach(collect);
    (playbackState.history || []).forEach(collect);

    const paths = [];
    const seen = {};
    for (let i = 0; i < localTracks.length; i++) {
      const fp = localTracks[i].filePath;
      if (fp && !seen[fp]) {
        seen[fp] = true;
        paths.push(fp);
      }
    }
    if (!paths.length) return;
    if (!window.musicAPI || typeof window.musicAPI.resolveLocalMediaUrls !== 'function') return;

    try {
      const result = await window.musicAPI.resolveLocalMediaUrls(paths);
      const map = (result && result.results) || {};
      for (let j = 0; j < localTracks.length; j++) {
        const t = localTracks[j];
        const entry = t.filePath ? map[t.filePath] : null;
        if (entry && entry.ok) {
          t.objectUrl = entry.url;
          t.fileMissing = false;
        } else {
          t.objectUrl = '';
          t.fileMissing = true;
        }
      }
      renderPlayback();
    } catch (_) {
      // Non-fatal: local tracks will re-check on play
    }
  }

  return {
    init,
    restoreLocalFileUrls,
    flushPlaybackStateOnUnload
  };
}
