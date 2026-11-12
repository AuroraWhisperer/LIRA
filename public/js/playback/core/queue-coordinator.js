'use strict';

import { createPlaybackStateActions } from '../state/actions.js';

export function createPlaybackQueueCoordinator({
  playbackState,
  stateActions: suppliedStateActions,
  queueManager,
  savePlaybackState,
  renderPlayback,
  getPlaybackAudio,
  syncPlaybackLyricWindow,
  invalidatePlaybackRequests,
  invalidateImports,
  playPlaybackTrack,
  ensurePlaybackRadioQueueFilled,
  toast,
}) {
  const stateActions =
    suppliedStateActions ||
    createPlaybackStateActions(playbackState, {
      save: savePlaybackState,
      render: renderPlayback,
    });

  function resetAudio() {
    const audio = getPlaybackAudio();
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function rebuildPlaybackShuffleOrder() {
    return queueManager.rebuildShuffleOrder();
  }

  async function startPlaybackCollection(tracks, selectedIndex, queueType, queueTitle = '', queueSourceKey = '', radioOffset) {
    if (!Array.isArray(tracks) || !tracks.some(Boolean)) return;
    invalidateImports?.();
    resetAudio();
    stateActions.clearCurrent();
    stateActions.clearPending();
    const track = queueManager.startCollection(tracks, selectedIndex, queueType, queueTitle, queueSourceKey, radioOffset);
    rebuildPlaybackShuffleOrder();
    savePlaybackState();
    await playPlaybackTrack(track, { origin: queueType === 'radio' ? 'radio' : 'normal' });
    if (queueType === 'radio') ensurePlaybackRadioQueueFilled();
  }

  function clearPlaybackQueue() {
    invalidatePlaybackRequests();
    invalidateImports?.();
    resetAudio();
    stateActions.clearCurrent();
    stateActions.clearPending();
    stateActions.clearHistory();
    queueManager.clearQueue();
    stateActions.commit();
    syncPlaybackLyricWindow();
  }

  function appendPlaybackTracks(tracks) {
    queueManager.appendTracks(tracks);
  }

  function insertPlaybackTracksNext(tracks) {
    queueManager.insertTracksNext(tracks);
    queueManager.rebuildShuffleOrder();
  }

  async function insertAndPlayPlaybackTrack(track) {
    const result = queueManager.insertAndPlayTrack(track);
    if (!result) return;
    if (result.shouldStartCollection) {
      await startPlaybackCollection(result.tracks, 0, result.queueType, result.title);
      return;
    }
    savePlaybackState();
    await playPlaybackTrack(result.track, { origin: result.origin });
  }

  function takeNextPlaybackTrack() {
    const result = queueManager.takeNext();
    if (result && playbackState.queueType === 'radio') {
      ensurePlaybackRadioQueueFilled();
    }
    return result;
  }

  function jumpToPlaylistTrack(index) {
    const track = playbackState.normalQueueTracks?.[index];
    if (!track) return;
    playPlaybackTrack(track, { origin: 'normal', playlistIndex: index });
  }

  function queuePlaybackTrack(track, action, options = {}) {
    if (!track) return;
    if (action === 'play') {
      insertAndPlayPlaybackTrack(track);
      return;
    }
    if (action === 'requested') {
      insertPlaybackTracksNext([{ ...track, requestedBy: options.requestedBy || '手动添加' }]);
      toast('已插入当前歌曲之后');
    } else if (action === 'radio') {
      startPlaybackCollection([track], 0, 'radio');
      toast('已切换到电台队列');
      return;
    } else {
      appendPlaybackTracks([track]);
      rebuildPlaybackShuffleOrder();
      toast('已加入当前队列');
    }
    savePlaybackState();
    renderPlayback();
  }

  return {
    startPlaybackCollection,
    appendPlaybackTracks,
    insertPlaybackTracksNext,
    insertAndPlayPlaybackTrack,
    takeNextPlaybackTrack,
    takePlaybackQueueTrack: (origin, index) => queueManager.takeQueueTrack(origin, index),
    clearPlaybackQueue,
    jumpToPlaylistTrack,
    queuePlaybackTrack,
    rebuildPlaybackShuffleOrder,
  };
}
