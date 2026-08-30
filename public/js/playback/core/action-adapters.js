'use strict';

export function createPlaybackActionAdapters({
  homeHandler,
  searchHandler,
  pendingHandler,
  importHandler,
  queueCoordinator,
  playlistOperations,
  providerOperations,
  savePlaybackState,
  renderPlayback,
  playPlaybackTrack,
}) {
  const {
    startPlaybackCollection,
    appendPlaybackTracks,
    insertPlaybackTracksNext,
    insertAndPlayPlaybackTrack,
    jumpToPlaylistTrack,
    queuePlaybackTrack,
    rebuildPlaybackShuffleOrder,
  } = queueCoordinator;

  const queueCallbacks = {
    startPlaybackCollection,
    appendPlaybackTracks,
    insertAndPlayPlaybackTrack,
    insertPlaybackTracksNext,
    queuePlaybackTrack,
    rebuildPlaybackShuffleOrder,
    jumpToPlaylistTrack,
    savePlaybackState,
    renderPlayback,
  };

  const searchCallbacks = {
    addTrackToPlaylist: (track) => playlistOperations.addTrackToPlaylist(track),
    insertAndPlayPlaybackTrack,
    insertPlaybackTracksNext,
    appendPlaybackTracks,
    startPlaybackCollection,
    playPlaybackTrack,
    rebuildPlaybackShuffleOrder,
    savePlaybackState,
    renderPlayback,
  };

  const homeTrackCallbacks = {
    ...queueCallbacks,
    removeTrackFromPlaylist: (track, action) =>
      playlistOperations.removeTrackFromPlaylist(track, action),
    addTrackToPlaylist: (track) => playlistOperations.addTrackToPlaylist(track),
  };

  return {
    loadPlaybackHomeContent: (action) =>
      homeHandler.loadPlaybackHomeContent(action, () =>
        providerOperations.getAuthState(),
      ),
    loadPlaybackPlaylistTracks: (index) =>
      homeHandler.loadPlaybackPlaylistTracks(index),
    refreshPlaybackHomeContent: () => homeHandler.refreshPlaybackHomeContent(),
    handlePlaybackHomeBulkAction: (action) =>
      homeHandler.handlePlaybackHomeBulkAction(action, queueCallbacks),
    handlePlaybackDrawerHeaderPlayAll: () =>
      homeHandler.handlePlaybackDrawerHeaderPlayAll(queueCallbacks),
    handlePlaybackHomeTrackAction: (action, index) =>
      homeHandler.handlePlaybackHomeTrackAction(
        action,
        index,
        homeTrackCallbacks,
      ),
    handlePlaybackSearchAction: (action, index) =>
      searchHandler.handlePlaybackSearchAction(action, index, searchCallbacks),
    handlePlaybackPendingAction: (action, index) =>
      pendingHandler.handlePlaybackPendingAction(
        action,
        index,
        playPlaybackTrack,
      ),
    importSongQueueToPlayback: () =>
      importHandler.importSongQueueToPlayback({
        insertPlaybackTracksNext,
        savePlaybackState,
        renderPlayback,
      }),
  };
}
