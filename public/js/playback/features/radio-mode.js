// 编写人：Aurora
// 电台模式模块
'use strict';

import { QueueManager } from '../queue/manager.js';

import * as PlaybackUtils from '../utils.js';

export function createRadioMode(deps) {
  const {
    playbackState,
    readJsonResponse,
    playbackRadioRefillThreshold,
    playbackRadioRefillBatchSize,
    savePlaybackState,
    renderPlayback,
  } = deps;

  const queueManager =
    deps.queueManager || new QueueManager({ state: playbackState });

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
          limit: playbackRadioRefillBatchSize,
        }),
      });
      const payload = await readJsonResponse(response, '补充电台队列失败');
      if (!response.ok || !payload.ok)
        throw new Error(payload.error || '补充电台队列失败');
      if (playbackState.queueType !== 'radio') return;

      const tracks = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks.map(PlaybackUtils.normalizeOnlineTrack)
        : [];
      queueManager.refillRadioQueue(tracks);

      savePlaybackState();
      renderPlayback();
    } catch (error) {
      console.warn('[playback] radio refill failed:', error.message || error);
    } finally {
      playbackRadioRefillRunning = false;
    }
  }

  return {
    ensurePlaybackRadioQueueFilled,
  };
}
