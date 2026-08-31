'use strict';

const { RemoteLicenseError } = require('./remote-license-client');
const {
  normalizeProcessedGiftPage,
} = require('../../shared/processed-gift-contract');
const {
  SONG_BACKGROUND_MAX_BYTES,
  SONG_BACKGROUND_TYPES,
  addSongBackgroundPreviewUrl,
  mapSongForSync,
} = require('./license-response-utils');

function createLicenseOperations(options = {}) {
  const remote = options.remote;
  const withAuthorizedToken = options.withAuthorizedToken;
  const withAuthorizedSecret = options.withAuthorizedSecret;

  async function getProfile() {
    const result = await withAuthorizedToken((token) => remote.profile(token));
    if (options.isDisposed()) throw new Error('LICENSE_NOT_AUTHORIZED');
    options.setProfile(result);
    return options.getSnapshot();
  }

  async function getCloudState() {
    return withAuthorizedToken((token) => remote.getCloudState(token));
  }

  async function watchCloudStateChangesInternal(options = {}) {
    return withAuthorizedToken(
      (token) => remote.watchCloudStateChanges(token, options),
      0,
      false,
    );
  }

  async function getGiftEventsInternal(input = {}) {
    const after = input.after;
    const limit = input.limit === undefined ? 200 : Number(input.limit);
    if (
      (after !== null &&
        after !== undefined &&
        (!Number.isSafeInteger(Number(after)) || Number(after) < 0)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      throw new RemoteLicenseError(
        'INVALID_GIFT_CURSOR',
        '礼物事件游标无效。',
      );
    }
    return withAuthorizedToken(
      async (token) => {
        const result = await remote.getGiftEvents(
          after === null || after === undefined ? null : Number(after),
          limit,
          token,
        );
        try {
          return normalizeProcessedGiftPage(result);
        } catch {
          throw new RemoteLicenseError(
            'INVALID_RESPONSE',
            '授权服务器返回无效响应。',
            { retryable: true },
          );
        }
      },
      0,
      false,
    );
  }

  async function watchGiftEventsInternal(options = {}) {
    return withAuthorizedToken(
      (token) => remote.watchGiftEvents(token, options),
      0,
      false,
    );
  }

  async function updateCloudSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new RemoteLicenseError(
        'INVALID_SYNC_SETTINGS',
        '云端同步设置格式无效。',
      );
    }
    return withAuthorizedToken((token) =>
      remote.updateCloudSettings(settings, token),
    );
  }

  async function getBilibiliCredentialsInternal() {
    return withAuthorizedSecret((token) =>
      remote.getBilibiliCredentials(token),
    );
  }

  async function setBilibiliCredentialsInternal(cookie) {
    const value = String(cookie || '').trim();
    if (!value || value.length > 12_000 || /[\r\n\0]/u.test(value)) {
      throw new RemoteLicenseError(
        'BILIBILI_CREDENTIALS_INVALID',
        'Bilibili 登录凭据无效。',
      );
    }
    return withAuthorizedToken((token) =>
      remote.setBilibiliCredentials(value, token),
    );
  }

  async function clearBilibiliCredentialsInternal() {
    return withAuthorizedToken((token) =>
      remote.clearBilibiliCredentials(token),
    );
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

  return {
    clearBilibiliCredentialsInternal,
    deleteSongPageBackground,
    getBilibiliCredentialsInternal,
    getCloudSongs,
    getCloudState,
    getGiftCatalog,
    getGiftEventsInternal,
    getProfile,
    getSongPageBackground,
    setBilibiliCredentialsInternal,
    syncSongs,
    updateCloudSettings,
    uploadSongPageBackground,
    watchCloudStateChangesInternal,
    watchGiftEventsInternal,
  };
}

module.exports = { createLicenseOperations };
