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
    toast = () => {},
  } = deps;

  const queueManager = deps.queueManager || new QueueManager({ state: playbackState });

  let refillSession = null;

  async function ensurePlaybackRadioQueueFilled() {
    if (playbackState.queueType !== 'radio') return;
    if (playbackState.radioQueue.length >= playbackRadioRefillThreshold) return;

    if (refillSession?.queue !== playbackState.radioQueue) {
      const sources = [
        String(playbackState.queueSourceKey || '').split(':')[0],
        playbackState.current?.source,
        playbackState.radioQueue[0]?.source,
        playbackState.selectedSource,
      ];
      refillSession = {
        queue: playbackState.radioQueue,
        platform: sources.find((source) => source === 'qq' || source === 'netease'),
        running: false,
        failedRefills: 0,
        failureNotified: false,
      };
    }
    const session = refillSession;
    if (session.running) return;

    session.running = true;
    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: session.platform,
          action: 'radio',
          limit: playbackRadioRefillBatchSize,
        }),
      });
      const payload = await readJsonResponse(response, '补充电台队列失败');
      if (!isActiveSession(session)) return;
      if (!response.ok || !payload.ok) throw new Error(payload.error || '补充电台队列失败');

      const tracks = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks.map(PlaybackUtils.normalizeOnlineTrack)
        : [];
      queueManager.refillRadioQueue(tracks);

      if (tracks.length) {
        if (session.failureNotified) toast('电台已补上新歌，可以继续听了。', { key: 'radio-refill', update: true, type: 'success' });
        session.failedRefills = 0;
        session.failureNotified = false;
      } else {
        reportRefillFailure(session);
      }

      savePlaybackState();
      renderPlayback();
    } catch (error) {
      console.warn('[playback] radio refill failed:', error.message || error);
      if (isActiveSession(session)) reportRefillFailure(session);
    } finally {
      session.running = false;
    }
  }

  function isActiveSession(session) {
    return playbackState.queueType === 'radio' && playbackState.radioQueue === session.queue;
  }

  function reportRefillFailure(session) {
    session.failedRefills += 1;
    if (!session.failureNotified && (session.failedRefills >= 2 || !session.queue.length)) {
      session.failureNotified = true;
      toast('电台暂时没能补上新歌，请检查网络后重新打开电台。', { key: 'radio-refill', update: true, type: 'warning' });
    }
  }

  return {
    ensurePlaybackRadioQueueFilled,
  };
}
