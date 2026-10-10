'use strict';

// The server measures this complete UTF-8 snapshot budget before committing.
const MAX_SONG_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function createRemoteSongs(request, requestRaw) {
  return {
    syncSongs: (songs, token, requestOptions) =>
      request('PUT', '/api/device/songs/sync', { songs }, token, requestOptions),
    getCloudSongs: (token, requestOptions = {}) =>
      request('GET', '/api/device/songs', undefined, token, {
        maxResponseBytes: MAX_SONG_SNAPSHOT_BYTES,
        signal: requestOptions.signal,
      }),
    getSongPageBackground: (token) => request('GET', '/api/device/song-page/background', undefined, token),
    uploadSongPageBackground: (bytes, contentType, token) =>
      requestRaw('PUT', '/api/device/song-page/background', bytes, contentType, token),
    deleteSongPageBackground: (token) => request('DELETE', '/api/device/song-page/background', undefined, token),
  };
}

module.exports = { createRemoteSongs };
