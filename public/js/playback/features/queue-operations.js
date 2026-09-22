'use strict';

import { createPlaybackStateActions } from '../state/actions.js';

export function createQueueOperations(deps) {
  const {
    playbackState,
    queueManager,
    savePlaybackState,
    renderPlayback,
    getPlaybackAudio,
    syncPlaybackLyricWindow,
    invalidatePlaybackRequests,
  } = deps;
  const stateActions =
    deps.stateActions ||
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
  function startPlaybackCollection(tracks, index, type, title = '', sourceKey = '') {
    if (!Array.isArray(tracks) || !tracks.some(Boolean)) return;
    resetAudio();
    stateActions.clearCurrent();
    stateActions.clearPending();
    const track = queueManager.startCollection(tracks, index, type, title, sourceKey);
    return { track, origin: type === 'radio' ? 'radio' : 'normal' };
  }
  function clearPlaybackQueue() {
    invalidatePlaybackRequests();
    resetAudio();
    stateActions.clearCurrent();
    stateActions.clearPending();
    stateActions.clearHistory();
    queueManager.clearQueue();
    stateActions.commit();
    syncPlaybackLyricWindow();
  }

  function jumpToPlaylistTrack(index, playPlaybackTrack) {
    const track = queueManager.jumpToPlaylistTrack(index);
    if (!track) return;
    savePlaybackState();
    playPlaybackTrack(track, { origin: 'normal' });
  }
  return {
    startPlaybackCollection,
    clearPlaybackQueue,
    jumpToPlaylistTrack,
    appendPlaybackTracks: (tracks) => queueManager.appendTracks(tracks),
    insertPlaybackTracksNext(tracks) {
      queueManager.insertTracksNext(tracks);
      queueManager.rebuildShuffleOrder();
    },
    insertAndPlayPlaybackTrack: (track) => queueManager.insertAndPlayTrack(track),
    takeNextPlaybackTrack: () => queueManager.takeNext(),
    takePlaybackQueueTrack: (origin, index) => queueManager.takeQueueTrack(origin, index),
    rebuildPlaybackShuffleOrder: () => queueManager.rebuildShuffleOrder(),
  };
}
