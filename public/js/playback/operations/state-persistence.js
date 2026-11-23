// 编写人：Aurora
// 状态持久化模块
'use strict';

import { PlaybackConfig } from '../config.js';

const MAX_SAVE_RETRIES = 3;
let nextSenderGeneration = 0;

// 恢复未获确认时，只比较当前曲目、队列成员及顺序。曲目元数据和偏好可以独立变化。
function queueIdentity(state) {
  const trackKey = (track) => track
    ? [track.source, track.id, track.songRequestKey || '', track.playNext === true]
    : null;
  return JSON.stringify([
    trackKey(state.current), state.queueType, state.queueSourceKey, state.playlistIndex,
    state.requestedQueue.map(trackKey), state.normalQueue.map(trackKey),
    state.normalQueueTracks.map(trackKey), state.radioQueue.map(trackKey),
    state.pendingRequests.map((item) => item && [item.id, item.songRequestKey, trackKey(item.track)]),
  ]);
}

/**
 * 创建状态持久化操作模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 状态持久化函数集合
 */
export function createStatePersistence(deps) {
  const { playbackState, getPlaybackAudio, toast = () => {} } = deps;

  const playbackClientId = PlaybackConfig.CLIENT_ID;
  const playbackStateSaveDebounceMs = PlaybackConfig.STATE_SAVE_DEBOUNCE_MS;
  let playbackStateSaveTimer = null;
  let maxWaitTimer = null;
  let playbackStateSavePending = null;
  let playbackStateSaveInFlight = null;
  let playbackStateSaveDirty = false;
  let fallbackQueueIdentity = null;
  let snapshotSequence = 0;
  let completedSaveSequence = 0;
  let saveWarning = false;
  let flushingOnExit = false;
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
      songRequestKey: track.songRequestKey || '',
      requestedBy: track.requestedBy || '',
      playNext: track.playNext === true,
    };
  }

  /**
   * 在实际发送前捕获最新状态，避免每次进度通知都复制完整队列。
   */
  function capturePlaybackState() {
    if (fallbackQueueIdentity !== null && queueIdentity(playbackState) === fallbackQueueIdentity) return null;
    const audio = getPlaybackAudio();
    const payload = {
      current: serializeTrack(playbackState.current),
      currentOrigin: playbackState.currentOrigin,
      requestedQueue: playbackState.requestedQueue.map(serializeTrack).filter(Boolean),
      normalQueue: playbackState.normalQueue.map(serializeTrack).filter(Boolean),
      normalQueueTracks: playbackState.normalQueueTracks.map(serializeTrack).filter(Boolean),
      radioQueue: playbackState.radioQueue.map(serializeTrack).filter(Boolean),
      radioOffset: playbackState.radioOffset,
      queueType: playbackState.queueType,
      queueTitle: playbackState.queueTitle,
      queueSourceKey: playbackState.queueSourceKey,
      playlistIndex: playbackState.playlistIndex,
      importedSongRequestKeys: playbackState.importedSongRequestKeys,
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
      snapshotVersion: { ...snapshotWriter, sequence: snapshotSequence },
    };
    fallbackQueueIdentity = null;
    return payload;
  }

  /**
   * 调度状态保存（防抖）
   */
  function savePlaybackState() {
    playbackStateSaveDirty = true;
    playbackStateSavePending = null;
    snapshotSequence += 1;
    if (playbackStateSaveTimer) clearTimeout(playbackStateSaveTimer);
    playbackStateSaveTimer = setTimeout(flushPlaybackStateSave, playbackStateSaveDebounceMs);
    if (maxWaitTimer === null) {
      maxWaitTimer = setTimeout(flushPlaybackStateSave, PlaybackConfig.STATE_SAVE_MAX_WAIT_MS);
    }
  }

  /**
   * 立即执行状态保存
   */
  async function flushPlaybackStateSave(retry = 0) {
    const payload = takePendingPayload();
    if (!payload) return;
    if (!playbackStateSaveInFlight ||
      playbackStateSaveInFlight.snapshotVersion.sequence <= payload.snapshotVersion.sequence) {
      playbackStateSaveInFlight = payload;
    }
    let saved = false;
    let stale = false;
    let retryable = false;
    try {
      const response = await fetch('/api/playback/queue-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: playbackClientId, payload }),
      });
      const result = response.ok ? await response.json() : null;
      saved = result?.ok === true && result.data?.saved === true;
      stale = result?.data?.reason === 'stale-snapshot';
      retryable = response.status >= 500;
    } catch (_) {
      retryable = true;
    } finally {
      if (playbackStateSaveInFlight === payload) playbackStateSaveInFlight = null;
    }
    if (stale) return;
    if (!saved && retainPendingPayload(payload) && retryable && retry < MAX_SAVE_RETRIES && !flushingOnExit) {
      playbackStateSaveTimer = setTimeout(() => flushPlaybackStateSave(retry + 1), playbackStateSaveDebounceMs * 2 ** retry);
    }
    reportSaveResult(payload, saved);
  }

  function reportSaveResult(payload, saved) {
    const sequence = payload.snapshotVersion.sequence;
    if (sequence < completedSaveSequence) return;
    completedSaveSequence = sequence;
    const notice = { key: 'playback-state-save', update: true };
    if (saved) {
      if (saveWarning) toast('播放队列和进度已保存。', { ...notice, type: 'success' });
      saveWarning = false;
    } else if (!saveWarning) {
      saveWarning = true;
      toast('播放队列和进度还没保存成功，先别关闭 LIRA。', { ...notice, type: 'warning' });
    }
  }

  function retainPendingPayload(payload) {
    if (payload.snapshotVersion.sequence !== snapshotSequence) return false;
    if (
      !playbackStateSavePending ||
      playbackStateSavePending.snapshotVersion.sequence < payload.snapshotVersion.sequence
    ) {
      playbackStateSavePending = payload;
      return true;
    }
    return false;
  }

  function takePendingPayload() {
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
    if (playbackStateSaveTimer) {
      clearTimeout(playbackStateSaveTimer);
      playbackStateSaveTimer = null;
    }
    const payload = playbackStateSaveDirty ? capturePlaybackState() : playbackStateSavePending;
    playbackStateSaveDirty = false;
    playbackStateSavePending = null;
    return payload;
  }

  function takeExplicitFlushPayload() {
    flushingOnExit = true;
    if (!playbackStateSaveDirty && !playbackStateSavePending && playbackState.current) {
      savePlaybackState();
    }
    if (playbackStateSaveDirty || playbackStateSavePending) return takePendingPayload();
    return playbackStateSaveInFlight;
  }

  /**
   * 在页面卸载时通过 IPC 和 HTTP 兜底通道提交同一份快照。
   */
  function flushPlaybackStateOnUnload() {
    const payload = takeExplicitFlushPayload();
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
    const payload = takeExplicitFlushPayload();
    if (!payload) return true;

    if (window.musicAPI && typeof window.musicAPI.savePlaybackState === 'function') {
      try {
        const result = await window.musicAPI.savePlaybackState(playbackClientId, payload);
        if (result?.saved === true) return true;
      } catch (_) {}
    }

    try {
      const response = await fetch('/api/playback/queue-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: playbackClientId, payload }),
        keepalive: true,
      });
      const result = response.ok ? await response.json() : null;
      if (result?.ok === true && result.data?.saved === true) return true;
    } catch (_) {}
    retainPendingPayload(payload);
    return false;
  }

  return {
    savePlaybackState,
    requireQueueEditBeforeSave() {
      fallbackQueueIdentity = queueIdentity(playbackState);
    },
    flushPlaybackStateSave,
    flushPlaybackStateOnUnload,
    flushPlaybackStateForShutdown,
  };
}
