// 编写人：Aurora
// 状态持久化模块
'use strict';

import { PlaybackConfig } from '../config.js';

let nextSenderGeneration = 0;

/**
 * 创建状态持久化操作模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 状态持久化函数集合
 */
export function createStatePersistence(deps) {
  const { playbackState, getPlaybackAudio } = deps;

  const playbackClientId = PlaybackConfig.CLIENT_ID;
  const playbackStateSaveDebounceMs = PlaybackConfig.STATE_SAVE_DEBOUNCE_MS;
  let playbackStateSaveTimer = null;
  let playbackStateSavePending = null;
  let snapshotSequence = 0;
  const bootWriter = deps.snapshotWriter || window.__PLAYBACK_SNAPSHOT_WRITER__;
  if (!bootWriter?.writerId || !Number.isSafeInteger(bootWriter.generation) || bootWriter.generation < 1) {
    throw new Error('播放快照启动信息缺失，请重新加载管理页。');
  }
  const snapshotWriter = {
    writerId: bootWriter.writerId,
    generation: bootWriter.generation,
    senderGeneration: ++nextSenderGeneration,
  };

  /**
   * 序列化轨道对象（过滤掉不需要保存的字段）
   */
  function serializeTrack(track) {
    if (!track) return null;
    const sourceSongType = Number(track.sourceSongType);
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
      sourceMediaId: track.sourceMediaId || '',
      sourceSongId: Math.max(0, Number(track.sourceSongId || track.songId) || 0),
      sourceSongType: Number.isSafeInteger(sourceSongType) && sourceSongType >= 0 ? sourceSongType : 0,
      sourceAlbumId: track.sourceAlbumId,
      playable: track.playable,
      vip: track.vip,
      unavailable: (track.source === 'local' && !track.objectUrl) || false,
      playedAt: track.playedAt || 0,
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
      queueSourceKey: playbackState.queueSourceKey,
      playlistIndex: playbackState.playlistIndex,
      pendingRequests: playbackState.pendingRequests
        .map((item) => ({
          ...item,
          track: serializeTrack(item.track),
        }))
        .filter((item) => item.track),
      currentTime:
        audio && audio.readyState >= 1 && Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : playbackState.restoredTime,
      volume: playbackState.volume,
      mode: playbackState.mode,
      selectedSource: playbackState.selectedSource,
      qualityPreferences: playbackState.qualityPreferences,
      shuffleOrder: playbackState.shuffleOrder,
      shuffleCursor: playbackState.shuffleCursor,
      history: playbackState.history.slice(-PlaybackConfig.HISTORY_MAX_SIZE).map(serializeTrack).filter(Boolean),
      displayHistory: playbackState.displayHistory
        .slice(0, PlaybackConfig.DISPLAY_HISTORY_MAX_SIZE)
        .map(serializeTrack)
        .filter(Boolean),
    };
    schedulePlaybackStateSave(payload);
  }

  /**
   * 调度状态保存（防抖）
   */
  function schedulePlaybackStateSave(payload) {
    playbackStateSavePending = {
      ...payload,
      snapshotVersion: { ...snapshotWriter, sequence: ++snapshotSequence },
    };
    if (playbackStateSaveTimer) clearTimeout(playbackStateSaveTimer);
    playbackStateSaveTimer = setTimeout(() => {
      void flushPlaybackStateSave();
    }, playbackStateSaveDebounceMs);
  }

  /**
   * 立即执行状态保存
   */
  async function flushPlaybackStateSave() {
    const payload = takePendingPayload();
    if (!payload) return;
    try {
      const response = await fetch('/api/playback/queue-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: playbackClientId, payload }),
      });
      if (!response.ok) retainPendingPayload(payload);
    } catch (_) {
      retainPendingPayload(payload);
    }
  }

  function retainPendingPayload(payload) {
    if (payload.snapshotVersion.sequence !== snapshotSequence) return;
    if (
      !playbackStateSavePending ||
      playbackStateSavePending.snapshotVersion.sequence < payload.snapshotVersion.sequence
    ) {
      playbackStateSavePending = payload;
    }
  }

  function takePendingPayload() {
    if (playbackStateSaveTimer) {
      clearTimeout(playbackStateSaveTimer);
      playbackStateSaveTimer = null;
    }
    const payload = playbackStateSavePending;
    playbackStateSavePending = null;
    return payload;
  }

  /**
   * 在页面卸载时通过 IPC 和 HTTP 兜底通道提交同一份快照。
   */
  function flushPlaybackStateOnUnload() {
    if (!playbackStateSavePending && playbackState.current) {
      savePlaybackState();
    }
    const payload = takePendingPayload();
    if (payload) sendUnloadSnapshot(payload);
  }

  function sendUnloadSnapshot(payload) {
    // 两条通道复用同一快照版本，store 将第二次到达视为幂等重放。
    if (window.musicAPI && typeof window.musicAPI.savePlaybackState === 'function') {
      try {
        const saveResult = window.musicAPI.savePlaybackState(playbackClientId, payload);
        if (saveResult && typeof saveResult.catch === 'function') saveResult.catch(() => {});
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
        keepalive: true,
      }).catch(() => {});
    }
  }

  /** Electron 关闭服务前等待最后一份状态写入 SQLite。 */
  async function flushPlaybackStateForShutdown() {
    if (!playbackStateSavePending && playbackState.current) {
      savePlaybackState();
    }
    const payload = takePendingPayload();
    if (!payload) return;

    if (window.musicAPI && typeof window.musicAPI.savePlaybackState === 'function') {
      try {
        const result = await window.musicAPI.savePlaybackState(playbackClientId, payload);
        if (!result || result.ok !== false) return;
      } catch (_) {}
    }

    try {
      const response = await fetch('/api/playback/queue-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: playbackClientId, payload }),
        keepalive: true,
      });
      if (!response.ok) retainPendingPayload(payload);
    } catch (_) {
      retainPendingPayload(payload);
    }
  }

  return {
    savePlaybackState,
    flushPlaybackStateSave,
    flushPlaybackStateOnUnload,
    flushPlaybackStateForShutdown,
  };
}
