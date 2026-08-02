// 编写人：Aurora
// 队列操作模块
'use strict';

import * as PlaybackUtils from '../utils.js';

export function createQueueOperations(deps) {
  const {
    playbackState,
    queueManager,
    savePlaybackState,
    renderPlayback,
    getPlaybackAudio,
    syncPlaybackLyricWindow
  } = deps;

  function startPlaybackCollection(tracks, selectedIndex, queueType, queueTitle = '') {
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;

    const index = Math.max(0, Math.min(items.length - 1, Number(selectedIndex) || 0));
    const type = queueType === 'radio' ? 'radio' : 'playlist';
    const audio = getPlaybackAudio();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    playbackState.current = null;
    playbackState.currentOrigin = '';
    playbackState.requestedQueue = [];
    playbackState.normalQueue = [];
    playbackState.normalQueueTracks = [];
    playbackState.radioQueue = [];
    playbackState.queueType = type;
    playbackState.queueTitle = queueTitle || (type === 'radio' ? '电台队列' : '歌单队列');
    playbackState.playlistIndex = type === 'playlist' ? index : -1;
    playbackState.pendingRequests = [];
    playbackState.shuffleOrder = [];
    playbackState.shuffleCursor = 0;
    playbackState.restoredTime = 0;

    if (type === 'playlist') {
      playbackState.normalQueueTracks = items.map((track) => ({ ...track }));
      playbackState.normalQueue = items.slice(index + 1).map((track) => ({ ...track }));
    } else {
      playbackState.radioQueue = items.slice(index + 1).map((track) => ({ ...track }));
    }

    return { track: items[index], origin: type === 'radio' ? 'radio' : 'normal' };
  }

  function appendPlaybackTracks(tracks) {
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;

    playbackState.requestedQueue = [];
    if (playbackState.queueType === 'radio') {
      playbackState.radioQueue.push(...items);
      return;
    }

    if (playbackState.queueType !== 'playlist') {
      playbackState.queueType = 'queue';
      playbackState.queueTitle = '播放队列';
      playbackState.normalQueueTracks = [];
      playbackState.playlistIndex = -1;
    } else {
      playbackState.normalQueueTracks.push(...items.map((track) => ({ ...track })));
    }
    playbackState.radioQueue = [];
    playbackState.normalQueue.push(...items);
  }

  function insertPlaybackTracksNext(tracks, rebuildShuffleOrder) {
    queueManager.insertTracksNext(tracks);
    rebuildShuffleOrder();
  }

  function insertAndPlayPlaybackTrack(track, rebuildShuffleOrder) {
    if (!track) return null;
    playbackState.requestedQueue = [];
    const origin = 'normal';

    if (playbackState.queueType === 'playlist' && playbackState.current) {
      const insertAt = Math.max(0, Math.min(
        playbackState.normalQueueTracks.length,
        playbackState.playlistIndex + 1
      ));
      playbackState.normalQueueTracks.splice(insertAt, 0, { ...track });
      playbackState.playlistIndex = insertAt;
      playbackState.radioQueue = [];
    } else if (playbackState.queueType === 'radio') {
      const historyTracks = [
        track,
        ...playbackState.displayHistory.filter((item) => item.id !== track.id)
      ];
      return { shouldStartCollection: true, tracks: historyTracks, queueType: 'playlist', title: '历史播放' };
    } else {
      playbackState.queueType = 'queue';
      playbackState.queueTitle = '播放队列';
      playbackState.normalQueueTracks = [];
      playbackState.radioQueue = [];
      playbackState.playlistIndex = -1;
    }
    rebuildShuffleOrder();
    return { track, origin };
  }

  function takeNextPlaybackTrack(takeNextShuffleNormalTrack) {
    if (playbackState.queueType !== 'radio' && playbackState.normalQueue.length > 0) {
      let track;
      if (playbackState.mode === 'shuffle') {
        track = takeNextShuffleNormalTrack();
      } else {
        track = playbackState.normalQueue.shift();
      }
      if (track && playbackState.queueType === 'playlist') {
        if (playbackState.mode === 'sequence') {
          playbackState.playlistIndex = Math.min(
            playbackState.normalQueueTracks.length - 1,
            playbackState.playlistIndex + 1
          );
        } else {
          playbackState.playlistIndex = playbackState.normalQueueTracks.findIndex((item) => item.id === track.id);
        }
      }
      if (track) return { origin: 'normal', track };
    }

    if (playbackState.queueType === 'radio' && playbackState.radioQueue.length > 0) {
      const track = playbackState.radioQueue.shift();
      return { origin: 'radio', track };
    }

    return null;
  }

  function takePlaybackQueueTrack(origin, index) {
    const queueName = String(origin || '');
    const activeOrigin = queueManager.getActiveOrigin();
    const queue = queueName === activeOrigin ? queueManager.getActiveQueue() : null;
    if (!queue || !Number.isInteger(index) || index < 0 || index >= queue.length) return null;

    const track = queue.splice(index, 1)[0];
    if (playbackState.queueType === 'playlist') {
      const sourceIndex = playbackState.normalQueueTracks.findIndex(
        (item, itemIndex) => itemIndex > playbackState.playlistIndex && item.id === track.id
      );
      if (sourceIndex >= 0) playbackState.normalQueueTracks.splice(sourceIndex, 1);
      const insertAt = playbackState.playlistIndex + 1;
      playbackState.normalQueueTracks.splice(insertAt, 0, { ...track });
      playbackState.playlistIndex = insertAt;
    }
    return {
      origin: activeOrigin,
      track
    };
  }

  function clearPlaybackQueue() {
    const audio = getPlaybackAudio();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    playbackState.current = null;
    playbackState.currentOrigin = '';
    playbackState.pendingRequests = [];
    playbackState.history = [];
    playbackState.restoredTime = 0;
    queueManager.clearQueue();
    savePlaybackState();
    renderPlayback();
    syncPlaybackLyricWindow();
  }

  function jumpToPlaylistTrack(index, rebuildShuffleOrder, playPlaybackTrack) {
    const tracks = playbackState.normalQueueTracks;
    if (!tracks || index < 0 || index >= tracks.length) return;
    const track = tracks[index];
    playbackState.playlistIndex = index;
    playbackState.normalQueue = tracks.slice(index + 1).map((t) => ({ ...t }));
    playbackState.radioQueue = [];
    rebuildShuffleOrder();
    savePlaybackState();
    playPlaybackTrack(track, { origin: 'normal' });
  }

  function rebuildPlaybackShuffleOrder() {
    const ids = playbackState.normalQueue.map((track) => track.id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    playbackState.shuffleOrder = ids;
    playbackState.shuffleCursor = 0;
  }

  function takeNextShuffleNormalTrack() {
    if (!playbackState.shuffleOrder.length) {
      rebuildPlaybackShuffleOrder();
    }
    while (playbackState.shuffleCursor < playbackState.shuffleOrder.length) {
      const nextId = playbackState.shuffleOrder[playbackState.shuffleCursor];
      playbackState.shuffleCursor += 1;
      const index = playbackState.normalQueue.findIndex((track) => track.id === nextId);
      if (index >= 0) {
        return playbackState.normalQueue.splice(index, 1)[0];
      }
    }
    return playbackState.normalQueue.shift() || null;
  }

  return {
    startPlaybackCollection,
    appendPlaybackTracks,
    insertPlaybackTracksNext,
    insertAndPlayPlaybackTrack,
    takeNextPlaybackTrack,
    takePlaybackQueueTrack,
    clearPlaybackQueue,
    jumpToPlaylistTrack,
    rebuildPlaybackShuffleOrder,
    takeNextShuffleNormalTrack
  };
}
