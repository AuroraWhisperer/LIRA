// 编写人：Aurora
// 状态持久化模块
'use strict';

import { PlaybackConfig } from '../config.js';

/**
 * 创建状态持久化操作模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 状态持久化函数集合
 */
export function createStatePersistence(deps) {
  const {
    playbackState,
    getPlaybackAudio
  } = deps;

  const playbackClientId = PlaybackConfig.CLIENT_ID;
  const playbackStateSaveDebounceMs = PlaybackConfig.STATE_SAVE_DEBOUNCE_MS;
  let playbackStateSaveTimer = null;
  let playbackStateSavePending = null;

  /**
   * 序列化轨道对象（过滤掉不需要保存的字段）
   */
  function serializeTrack(track) {
    if (!track) return null;
    return {
      id: track.id,
      source: track.source,
      title: track.title,
      artists: track.artists,
      album: track.album,
      coverUrl: track.coverUrl || '',
      durationMs: track.durationMs,
      fileName: track.fileName,
      filePath: track.filePath || '',
      sourceTrackId: track.sourceTrackId,
      sourceAlbumId: track.sourceAlbumId,
      playable: track.playable,
      vip: track.vip,
      unavailable: (track.source === 'local' && !track.objectUrl) || false,
      playedAt: track.playedAt || 0
    };
  }

  /**
   * 保存播放状态（防抖版本）
   */
  function savePlaybackState() {
    const audio = getPlaybackAudio();
    const payload = {
      current: serializeTrack(playbackState.current),
      currentOrigin: playbackState.currentOrigin,
      requestedQueue: playbackState.requestedQueue.map(serializeTrack).filter(Boolean),
      normalQueue: playbackState.normalQueue.map(serializeTrack).filter(Boolean),
      normalQueueTracks: playbackState.normalQueueTracks.map(serializeTrack).filter(Boolean),
      radioQueue: playbackState.radioQueue.map(serializeTrack).filter(Boolean),
      queueType: playbackState.queueType,
      queueTitle: playbackState.queueTitle,
      playlistIndex: playbackState.playlistIndex,
      pendingRequests: playbackState.pendingRequests.map((item) => ({
        ...item,
        track: serializeTrack(item.track)
      })).filter((item) => item.track),
      currentTime: audio && audio.readyState >= 1 && Number.isFinite(audio.currentTime) ? audio.currentTime : playbackState.restoredTime,
      volume: playbackState.volume,
      mode: playbackState.mode,
      selectedSource: playbackState.selectedSource,
      shuffleOrder: playbackState.shuffleOrder,
      shuffleCursor: playbackState.shuffleCursor,
      history: playbackState.history.slice(-50).map(serializeTrack).filter(Boolean),
      displayHistory: playbackState.displayHistory.slice(0, 200).map(serializeTrack).filter(Boolean)
    };
    schedulePlaybackStateSave(payload);
  }

  /**
   * 调度状态保存（防抖）
   */
  function schedulePlaybackStateSave(payload) {
    playbackStateSavePending = payload;
    if (playbackStateSaveTimer) clearTimeout(playbackStateSaveTimer);
    playbackStateSaveTimer = setTimeout(flushPlaybackStateSave, playbackStateSaveDebounceMs);
  }

  /**
   * 立即执行状态保存
   */
  function flushPlaybackStateSave() {
    if (playbackStateSaveTimer) {
      clearTimeout(playbackStateSaveTimer);
      playbackStateSaveTimer = null;
    }
    if (!playbackStateSavePending) return;
    const payload = playbackStateSavePending;
    playbackStateSavePending = null;
    fetch('/api/playback/queue-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: playbackClientId, payload })
    }).catch(() => {});
  }

  /**
   * 在页面卸载时强制保存状态（使用 sendBeacon 或同步请求）
   */
  function flushPlaybackStateOnUnload() {
    if (!playbackStateSavePending && playbackState.current) {
      savePlaybackState();
    }
    if (!playbackStateSavePending) return;
    const payload = playbackStateSavePending;
    playbackStateSavePending = null;
    if (playbackStateSaveTimer) {
      clearTimeout(playbackStateSaveTimer);
      playbackStateSaveTimer = null;
    }

    // 优先使用桌面端的同步保存 API
    if (window.musicAPI && typeof window.musicAPI.savePlaybackState === 'function') {
      try {
        window.musicAPI.savePlaybackState(playbackClientId, payload);
      } catch (_) {}
    }

    const body = JSON.stringify({ clientId: playbackClientId, payload });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const token = window.__API_TOKEN__;
      const beaconUrl = `/api/playback/queue-state${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      navigator.sendBeacon(beaconUrl, blob);
    } else {
      fetch('/api/playback/queue-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    }
  }

  return {
    savePlaybackState,
    flushPlaybackStateSave,
    flushPlaybackStateOnUnload
  };
}
