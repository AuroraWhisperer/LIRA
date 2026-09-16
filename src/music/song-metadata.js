'use strict';

const songService = require('./song-service');

// Snapshot metadata changes with the song database, not with gift/lyric events.
function createSongMetadataReader(store) {
  let version;
  let snapshot;
  return function readSongMetadata() {
    const nextVersion = store.getChangeToken();
    if (snapshot && version === nextVersion) return snapshot;
    snapshot = {
      categories: songService.listCategories(store),
      tags: songService.listTags(store),
      songCount: songService.countSongs(store),
    };
    version = nextVersion;
    return snapshot;
  };
}

module.exports = { createSongMetadataReader };
