'use strict';

const { safeState, safeErrorIndex, copyPrimitiveField, sanitizePublicUrl, sanitizeRelativeUrl } = require('./license-public-values');
const SONG_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
const SONG_PUBLIC_FIELDS = [
  'id',
  'title',
  'name',
  'artist',
  'categoryName',
  'category_name',
  'tags',
  'language',
  'sourcePlatform',
  'source_platform',
  'note',
  'requestPrice',
  'request_price',
  'songClip',
  'song_clip',
  'enabled',
  'isEnabled',
  'is_enabled',
  'sortOrder',
  'sort_order',
  'createdAt',
  'updatedAt',
];

function registerLicenseSongsIpc({ safeHandle, licenseManager, getCloudSyncController = () => null }) {
  function controller() {
    const value = getCloudSyncController();
    if (!value) throw Object.assign(new Error(), { code: 'CLOUD_SYNC_NOT_READY' });
    return value;
  }
  safeHandle('license:get-local-song-count', () => {
    const { count, generation } = controller().getLocalSongCount();
    return { ok: true, count, generation };
  });
  safeHandle('license:sync-current-songs', (generation) => {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw Object.assign(new Error(), { code: 'CLOUD_SONGS_CHANGED' });
    }
    return controller().syncCurrentSongs(generation).then(sanitizeSyncResponse);
  });
  safeHandle('license:sync-songs', (songs) => {
    if (!Array.isArray(songs) || songs.length > 5000)
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'SONG_LIST_INVALID',
      };
    if (JSON.stringify(songs).length > 4 * 1024 * 1024)
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'SONG_LIST_TOO_LARGE',
      };
    return controller().syncSongs(songs).then(sanitizeSyncResponse);
  });
  safeHandle('license:get-song-page-background', () =>
    licenseManager.getSongPageBackground().then((result) => sanitizeBackgroundResponse(result)),
  );
  safeHandle('license:get-cloud-songs', () =>
    licenseManager.getCloudSongs().then((result) => sanitizeCloudSongsResponse(result)),
  );
  safeHandle('license:get-cloud-song-count', async () => {
    const { count } = await licenseManager.getCloudSongCount();
    return { ok: true, count };
  });
  safeHandle('license:upload-song-page-background', (payload) => {
    const bytes = payload?.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.length) {
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'BACKGROUND_IMAGE_REQUIRED',
      };
    }
    if (bytes.byteLength > SONG_BACKGROUND_MAX_BYTES) {
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'PAYLOAD_TOO_LARGE',
      };
    }
    return licenseManager
      .uploadSongPageBackground(bytes, payload?.fileName)
      .then((result) => sanitizeBackgroundResponse({ ok: true, ...result }));
  });
  safeHandle('license:delete-song-page-background', () =>
    licenseManager.deleteSongPageBackground().then((result) => sanitizeBackgroundResponse(result)),
  );

}

function sanitizeSyncResponse(result = {}) {
  const response = { ok: result?.ok !== false };
  copyPrimitiveField(response, result, 'count');
  const index = safeErrorIndex(result?.index);
  if (index !== undefined) response.index = index;
  const songPageUrl = sanitizePublicUrl(result?.songPageUrl);
  if (songPageUrl !== undefined) response.songPageUrl = songPageUrl;
  return response;
}

function sanitizeCloudSongsResponse(result = {}) {
  const rawSongs = Array.isArray(result)
    ? result
    : Array.isArray(result?.songs)
      ? result.songs
      : Array.isArray(result?.items)
        ? result.items
        : [];
  const songs = rawSongs.map(sanitizeSong).filter(Boolean);
  return { songs };
}

function sanitizeSong(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of SONG_PUBLIC_FIELDS) copyPrimitiveField(result, value, key);
  return result;
}

function sanitizeBackgroundResponse(result = {}) {
  const response = { ok: result?.ok !== false, background: null };
  const background = sanitizeBackgroundInfo(result?.background);
  if (background) response.background = background;
  return response;
}

function sanitizeBackgroundInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  const url = sanitizeRelativeUrl(value.url);
  const previewUrl = sanitizePublicUrl(value.previewUrl);
  if (url !== undefined) result.url = url;
  if (previewUrl !== undefined) result.previewUrl = previewUrl;
  copyPrimitiveField(result, value, 'bytes');
  copyPrimitiveField(result, value, 'updatedAt');
  return Object.keys(result).length ? result : null;
}

module.exports = { registerLicenseSongsIpc };
