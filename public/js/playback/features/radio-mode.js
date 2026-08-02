// 编写人：Aurora
// 电台模式模块
'use strict';

import * as PlaybackUtils from '../utils.js';

export function createRadioMode(deps) {
  const {
    playbackState,
    readJsonResponse,
    playbackRadioRefillThreshold,
    playbackRadioRefillBatchSize,
    savePlaybackState,
    renderPlayback
  } = deps;

  let playbackRadioRefillRunning = false;

  async function ensurePlaybackRadioQueueFilled() {
    if (playbackState.queueType !== 'radio') return;
    if (playbackRadioRefillRunning) return;
    if (playbackState.radioQueue.length >= playbackRadioRefillThreshold) return;

    playbackRadioRefillRunning = true;
    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: playbackState.selectedSource,
          action: 'radio',
          limit: playbackRadioRefillBatchSize
        })
      });
      const payload = await readJsonResponse(response, '补充电台队列失败');
      if (!response.ok || !payload.ok) throw new Error(payload.error || '补充电台队列失败');
      if (playbackState.queueType !== 'radio') return;

      const tracks = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks.map(PlaybackUtils.normalizeOnlineTrack)
        : [];
      const recentIds = new Set(playbackState.history.slice(-30).map((track) => track.id));

      for (const track of tracks) {
        if (recentIds.has(track.id)) continue;
        if (playbackState.radioQueue.some((item) => item.id === track.id)) continue;
        playbackState.radioQueue.push(track);
      }

      savePlaybackState();
      renderPlayback();
    } catch (error) {
      console.warn('[playback] radio refill failed:', error.message || error);
    } finally {
      playbackRadioRefillRunning = false;
    }
  }

  return {
    ensurePlaybackRadioQueueFilled
  };
}
