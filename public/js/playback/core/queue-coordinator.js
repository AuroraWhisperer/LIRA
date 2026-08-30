'use strict';

import { createQueueOperations } from '../features/queue-operations.js';

export function createPlaybackQueueCoordinator({
  playbackState,
  queueManager,
  savePlaybackState,
  renderPlayback,
  getPlaybackAudio,
  syncPlaybackLyricWindow,
  playPlaybackTrack,
  ensurePlaybackRadioQueueFilled,
  toast,
}) {
  const queueOps = createQueueOperations({
    playbackState,
    queueManager,
    savePlaybackState,
    renderPlayback,
    getPlaybackAudio,
    syncPlaybackLyricWindow,
  });

  function rebuildPlaybackShuffleOrder() {
    return queueOps.rebuildPlaybackShuffleOrder();
  }

  function takeNextShuffleNormalTrack() {
    return queueOps.takeNextShuffleNormalTrack();
  }

  async function startPlaybackCollection(
    tracks,
    selectedIndex,
    queueType,
    queueTitle = '',
    queueSourceKey = '',
  ) {
    const result = queueOps.startPlaybackCollection(
      tracks,
      selectedIndex,
      queueType,
      queueTitle,
      queueSourceKey,
    );
    if (!result) return;
    rebuildPlaybackShuffleOrder();
    savePlaybackState();
    await playPlaybackTrack(result.track, { origin: result.origin });
    if (queueType === 'radio') ensurePlaybackRadioQueueFilled();
  }

  function appendPlaybackTracks(tracks) {
    queueOps.appendPlaybackTracks(tracks);
  }

  function insertPlaybackTracksNext(tracks) {
    queueOps.insertPlaybackTracksNext(tracks, rebuildPlaybackShuffleOrder);
  }

  async function insertAndPlayPlaybackTrack(track) {
    const result = queueOps.insertAndPlayPlaybackTrack(
      track,
      rebuildPlaybackShuffleOrder,
    );
    if (!result) return;
    if (result.shouldStartCollection) {
      await startPlaybackCollection(
        result.tracks,
        0,
        result.queueType,
        result.title,
      );
      return;
    }
    savePlaybackState();
    await playPlaybackTrack(result.track, { origin: result.origin });
  }

  function takeNextPlaybackTrack() {
    const result = queueOps.takeNextPlaybackTrack(takeNextShuffleNormalTrack);
    if (result && playbackState.queueType === 'radio') {
      ensurePlaybackRadioQueueFilled();
    }
    return result;
  }

  function jumpToPlaylistTrack(index) {
    queueOps.jumpToPlaylistTrack(
      index,
      rebuildPlaybackShuffleOrder,
      playPlaybackTrack,
    );
  }

  function queuePlaybackTrack(track, action, options = {}) {
    if (!track) return;
    if (action === 'play') {
      insertAndPlayPlaybackTrack(track);
      return;
    }
    if (action === 'requested') {
      insertPlaybackTracksNext([
        { ...track, requestedBy: options.requestedBy || '手动添加' },
      ]);
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
    takePlaybackQueueTrack: (...args) =>
      queueOps.takePlaybackQueueTrack(...args),
    clearPlaybackQueue: (...args) => queueOps.clearPlaybackQueue(...args),
    jumpToPlaylistTrack,
    queuePlaybackTrack,
    rebuildPlaybackShuffleOrder,
  };
}
