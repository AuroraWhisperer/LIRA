// 编写人：Aurora
// 初始化模块
'use strict';

import * as PlaybackUtils from '../utils.js';

export function createInitializer(deps) {
  const {
    playbackState,
    getPlaybackAudio,
    uiRenderer,
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
    refreshSelectedMusicProviderState,
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

    // 设置全屏播放器 seek 回调
    uiRenderer.getFullscreenPlayer().setSeekCallback(() => {
      renderPlaybackProgress();
      syncPlaybackLyricWindow(true);
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
      syncPlaybackLyricWindow(true);
    });

    audio.addEventListener('pause', () => {
      renderPlayback();
      updatePlaybackMediaSession();
      syncPlaybackLyricWindow(true);
      savePlaybackState();
    });

    audio.addEventListener('seeking', () => {
      renderPlaybackProgress();
      renderFullscreenPlayer();
      syncPlaybackLyricWindow(true);
    });

    audio.addEventListener('seeked', () => {
      renderPlaybackProgress();
      renderFullscreenPlayer();
      syncPlaybackLyricWindow(true);
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
    const collectUnresolvedLocalTrack = function (track) {
      if (track && track.source === 'local' && !track.objectUrl && track.filePath) localTracks.push(track);
    };
    collectUnresolvedLocalTrack(playbackState.current);
    (playbackState.requestedQueue || []).forEach(collectUnresolvedLocalTrack);
    (playbackState.normalQueue || []).forEach(collectUnresolvedLocalTrack);
    (playbackState.normalQueueTracks || []).forEach(collectUnresolvedLocalTrack);
    (playbackState.radioQueue || []).forEach(collectUnresolvedLocalTrack);
    (playbackState.history || []).forEach(collectUnresolvedLocalTrack);

    const filePaths = [];
    const seenPaths = {};
    for (let i = 0; i < localTracks.length; i++) {
      const filePath = localTracks[i].filePath;
      if (filePath && !seenPaths[filePath]) {
        seenPaths[filePath] = true;
        filePaths.push(filePath);
      }
    }
    if (!filePaths.length) return;
    if (!window.musicAPI || typeof window.musicAPI.resolveLocalMediaUrls !== 'function') return;

    try {
      const result = await window.musicAPI.resolveLocalMediaUrls(filePaths);
      const resultsByPath = (result && result.results) || {};
      for (let j = 0; j < localTracks.length; j++) {
        const track = localTracks[j];
        const entry = track.filePath ? resultsByPath[track.filePath] : null;
        if (entry && entry.ok) {
          track.objectUrl = entry.url;
          track.fileMissing = false;
        } else {
          track.objectUrl = '';
          track.fileMissing = true;
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
    flushPlaybackStateOnUnload,
  };
}
