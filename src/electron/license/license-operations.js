'use strict';

const { RemoteLicenseError } = require('./remote-license-client');
const {
  SONG_BACKGROUND_MAX_BYTES,
  SONG_BACKGROUND_TYPES,
  addSongBackgroundPreviewUrl,
  mapSongForSync,
} = require('./license-response-utils');

function createLicenseOperations(options = {}) {
  const remote = options.remote;
  const withAuthorizedToken = options.withAuthorizedToken;

  async function getProfile() {
    const result = await withAuthorizedToken((token) => remote.profile(token));
    if (options.isDisposed()) throw new Error('LICENSE_NOT_AUTHORIZED');
    options.setProfile(result);
    return options.getSnapshot();
  }

  async function syncSongs(songs) {
    if (!Array.isArray(songs) || songs.length > 5000)
      throw new RemoteLicenseError(
        'SONG_LIST_INVALID',
        '歌库数量超出同步上限。',
      );
    return withAuthorizedToken((token) =>
      remote.syncSongs(songs.map(mapSongForSync), token),
    );
  }

  async function getCloudSongs() {
    return withAuthorizedToken((token) => remote.getCloudSongs(token));
  }

  async function getGiftCatalog(input = {}) {
    const etag = String(input?.etag || '')
      .trim()
      .slice(0, 256);
    // This is a public read model. Authorization gates the refresh, but the
    // public endpoint deliberately receives no DeviceBearer token.
    const result = await withAuthorizedToken(() => remote.getGiftCatalog(etag));
    const response =
      result && typeof result === 'object' && !Array.isArray(result)
        ? result
        : {};
    return { ...response, imageBaseUrl: remote.baseUrl };
  }

  async function getSongPageBackground() {
    const result = await withAuthorizedToken((token) =>
      remote.getSongPageBackground(token),
    );
    return addSongBackgroundPreviewUrl(result, remote.baseUrl);
  }

  async function uploadSongPageBackground(bytes, fileName) {
    const buffer = bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
    if (!buffer?.length)
      throw new RemoteLicenseError(
        'BACKGROUND_IMAGE_REQUIRED',
        '请选择图片文件。',
      );
    if (buffer.length > SONG_BACKGROUND_MAX_BYTES)
      throw new RemoteLicenseError(
        'PAYLOAD_TOO_LARGE',
        '图片超过 5MB，请压缩后再上传。',
      );
    const extension =
      String(fileName || '')
        .split('.')
        .pop()
        ?.toLowerCase() || '';
    const contentType = SONG_BACKGROUND_TYPES.get(extension);
    if (!contentType)
      throw new RemoteLicenseError(
        'BACKGROUND_FORMAT_UNSUPPORTED',
        '仅支持 PNG / JPG / WebP / GIF 图片。',
      );
    const result = await withAuthorizedToken((token) =>
      remote.uploadSongPageBackground(buffer, contentType, token),
    );
    return addSongBackgroundPreviewUrl(result, remote.baseUrl);
  }

  async function deleteSongPageBackground() {
    return withAuthorizedToken((token) =>
      remote.deleteSongPageBackground(token),
    );
  }

  async function createPairingCode() {
    return withAuthorizedToken((token) => remote.createPairingCode(token));
  }

  async function listPairingCodes() {
    return withAuthorizedToken((token) => remote.listPairingCodes(token));
  }

  async function revokePairingCode(id) {
    return withAuthorizedToken((token) => remote.revokePairingCode(id, token));
  }

  return {
    createPairingCode,
    deleteSongPageBackground,
    getCloudSongs,
    getGiftCatalog,
    getProfile,
    getSongPageBackground,
    listPairingCodes,
    revokePairingCode,
    syncSongs,
    uploadSongPageBackground,
  };
}

module.exports = { createLicenseOperations };
