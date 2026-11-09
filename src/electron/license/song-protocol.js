'use strict';

const { RemoteLicenseError } = require('./remote-license-error');
const { SONG_BACKGROUND_MAX_BYTES, SONG_BACKGROUND_TYPES, addSongBackgroundPreviewUrl, mapSongForSync } = require('./license-response-utils');

const MAX_SONG_SYNC_REQUEST_BYTES = 5 * 1024 * 1024;

// The server measures this complete UTF-8 snapshot budget before committing.
const MAX_SONG_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function createSongEndpoints({ request, requestRaw }) {
  return {
    syncSongs: (songs, token, requestOptions) =>
      request('PUT', '/api/device/songs/sync', { songs }, token, requestOptions),
    getCloudSongs: (token, requestOptions = {}) =>
      request('GET', '/api/device/songs', undefined, token, {
        maxResponseBytes: MAX_SONG_SNAPSHOT_BYTES,
        responseTooLargeMessage: '云端歌库超过读取上限。',
        retryResponseTooLarge: false,
        signal: requestOptions.signal,
      }),
    getSongPageAccess: (token) => request('GET', '/api/device/song-page/access', undefined, token),
    setSongPageAccess: (enabled, token) => request('PUT', '/api/device/song-page/access', { enabled }, token),
    getSongPageBackground: (token) => request('GET', '/api/device/song-page/background', undefined, token),
    uploadSongPageBackground: (bytes, contentType, token) =>
      requestRaw('PUT', '/api/device/song-page/background', bytes, contentType, token),
    deleteSongPageBackground: (token) => request('DELETE', '/api/device/song-page/background', undefined, token),
  };
}

function createSongOperations({ remote, withAuthorizedToken }) {
  function acceptSongPageAccess(result) {
    if (typeof result?.enabled !== 'boolean') throw new RemoteLicenseError('INVALID_RESPONSE');
    return { enabled: result.enabled };
  }

  function getSongPageAccess() {
    return withAuthorizedToken((token) => remote.getSongPageAccess(token), { acceptResult: acceptSongPageAccess });
  }

  function setSongPageAccess(enabled) {
    if (typeof enabled !== 'boolean') throw new RemoteLicenseError('INVALID_SONG_PAGE_ACCESS');
    return withAuthorizedToken((token) => remote.setSongPageAccess(enabled, token), { acceptResult: acceptSongPageAccess });
  }

  async function syncSongs(songs, requestOptions = {}) {
    if (!Array.isArray(songs)) throw new RemoteLicenseError('SONG_LIST_INVALID', '歌库格式无效。');
    if (songs.length > 5000)
      throw new RemoteLicenseError('TOO_MANY_SONGS', '歌库超过 5000 首，请先整理后重新同步。');
    const snapshot = songs.map(mapSongForSync);
    if (Buffer.byteLength(JSON.stringify({ songs: snapshot }), 'utf8') > MAX_SONG_SYNC_REQUEST_BYTES) {
      throw new RemoteLicenseError('PAYLOAD_TOO_LARGE', '歌库数据超过同步大小限制，请减少歌曲或缩短备注、点歌价格和歌切后重新同步。');
    }
    return withAuthorizedToken(
      (token) => remote.syncSongs(snapshot, token, requestOptions),
      {
        acceptResult: (result) => {
          if (result?.ok !== true || result.count !== snapshot.length) {
            throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效的歌库同步确认。', { retryable: true });
          }
          return result;
        },
        signal: requestOptions.signal,
      },
    );
  }

  async function getCloudSongs(requestOptions = {}) {
    return withAuthorizedToken(
      (token) => remote.getCloudSongs(token, requestOptions), { signal: requestOptions.signal },
    );
  }

  function getCloudSongCount() {
    return withAuthorizedToken(async (token) => {
      const state = await remote.getCloudState(token);
      const count = state?.songs?.count;
      if (count !== undefined) {
        if (!Number.isSafeInteger(count) || count < 0) throw new RemoteLicenseError('INVALID_RESPONSE');
        return { count };
      }
      // Older servers expose only the complete song snapshot. Use the same
      // authorized operation so a changed account cannot take over this read.
      const result = await remote.getCloudSongs(token);
      if (!Array.isArray(result?.songs)) throw new RemoteLicenseError('INVALID_RESPONSE');
      return { count: result.songs.length };
    });
  }

  async function getSongPageBackground() {
    const result = await withAuthorizedToken((token) => remote.getSongPageBackground(token));
    return addSongBackgroundPreviewUrl(result, remote.baseUrl);
  }

  async function uploadSongPageBackground(bytes, fileName) {
    const buffer = bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
    if (!buffer?.length) throw new RemoteLicenseError('BACKGROUND_IMAGE_REQUIRED', '请选择图片文件。');
    if (buffer.length > SONG_BACKGROUND_MAX_BYTES)
      throw new RemoteLicenseError('PAYLOAD_TOO_LARGE', '图片超过 5MB，请压缩后再上传。');
    const extension =
      String(fileName || '')
        .split('.')
        .pop()
        ?.toLowerCase() || '';
    const contentType = SONG_BACKGROUND_TYPES.get(extension);
    if (!contentType)
      throw new RemoteLicenseError('BACKGROUND_FORMAT_UNSUPPORTED', '仅支持 PNG / JPG / WebP / GIF 图片。');
    const result = await withAuthorizedToken((token) => remote.uploadSongPageBackground(buffer, contentType, token));
    return addSongBackgroundPreviewUrl(result, remote.baseUrl);
  }

  async function deleteSongPageBackground() {
    return withAuthorizedToken((token) => remote.deleteSongPageBackground(token));
  }

  return { syncSongs, getCloudSongs, getCloudSongCount, getSongPageAccess, setSongPageAccess, getSongPageBackground, uploadSongPageBackground, deleteSongPageBackground };
}

module.exports = { createSongEndpoints, createSongOperations };
