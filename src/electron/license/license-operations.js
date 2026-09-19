'use strict';

const { RemoteLicenseError } = require('./remote-license-client');
const { sanitizeWelcomeV2 } = require('../../shared/welcome-settings-contract');
const {
  normalizeProcessedGiftHistoryPage,
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
    return withAuthorizedToken(
      (token) => remote.profile(token),
      0,
      true,
      (result) => {
        options.setProfile(result);
        return options.getSnapshot();
      },
    );
  }

  async function getCloudState(requestOptions = {}) {
    return withAuthorizedToken((token) =>
      remote.getCloudState(token, requestOptions),
    );
  }

  async function getOverlaySettings() {
    return overlayOperation((token) => remote.getOverlaySettings(token));
  }

  async function updateOverlaySettings(settings) {
    return overlayOperation((token) => remote.updateOverlaySettings(settings, token));
  }

  function overlayFilterOperation(operation) {
    return overlayOperation(async (token) => {
      try { return await operation(token); }
      catch (error) {
        if (error.status === 404 || error.status === 405) {
          throw new RemoteLicenseError('OVERLAY_FILTERS_UNSUPPORTED', '请更新服务器后使用弹幕屏蔽。');
        }
        throw error;
      }
    });
  }

  async function getOverlayFilters() {
    return overlayFilterOperation((token) => remote.getOverlayFilters(token));
  }

  async function updateOverlayFilters(settings) {
    return overlayFilterOperation((token) => remote.updateOverlayFilters(settings, token));
  }

  async function getOverlayViewers() {
    return overlayFilterOperation((token) => remote.getOverlayViewers(token));
  }

  async function getWelcomeSettings() {
    return overlayOperation((token) => remote.getWelcomeSettings(token));
  }

  async function dailyBotRequestInternal(operation, input = {}) {
    return overlayOperation((token) => remote.dailyBotRequest(operation, input, token));
  }

  async function getWelcomeSettingsV2() {
    return overlayOperation(async (token) => {
      try { return sanitizeWelcomeV2(await remote.getWelcomeSettingsV2(token)); }
      catch (error) {
        if (error.status !== 404) throw error;
        return { ...await remote.getWelcomeSettings(token), schemaVersion: 1 };
      }
    });
  }

  async function updateWelcomeSettingsV2(settings) {
    return overlayOperation((token) => remote.updateWelcomeSettingsV2(settings, token));
  }

  async function getPkReportSettings() {
    return overlayOperation((token) => remote.getPkReportSettings(token));
  }

  async function updatePkReportSettings(settings) {
    return overlayOperation((token) => remote.updatePkReportSettings(settings, token));
  }

  async function updateWelcomeSettings(settings) {
    return overlayOperation((token) => remote.updateWelcomeSettings(settings, token));
  }

  function overlayOperation(operation) {
    const owner = options.getOverlayOwner();
    const assertOwner = () => {
      if (options.isDisposed() || owner !== options.getOverlayOwner()) {
        throw new RemoteLicenseError('LICENSE_NOT_AUTHORIZED', '授权账号已变化，请重新读取配置。');
      }
    };
    return withAuthorizedToken(async (token) => {
      assertOwner();
      const result = await operation(token);
      assertOwner();
      return result;
    });
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
    const limit = input.limit === undefined ? 200 : input.limit;
    const syncEpoch =
      input.syncEpoch === null || input.syncEpoch === undefined
        ? null
        : input.syncEpoch;
    if (
      (after !== null &&
        after !== undefined &&
        (!Number.isSafeInteger(after) || after < 0)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      (syncEpoch !== null &&
        (typeof syncEpoch !== 'string' || !syncEpoch || syncEpoch.length > 128))
    ) {
      throw new RemoteLicenseError('INVALID_GIFT_CURSOR', '礼物事件游标无效。');
    }
    return withAuthorizedToken(
      async (token) => {
        const result = await remote.getGiftEvents(
          after === null || after === undefined ? null : after,
          limit,
          token,
          { syncEpoch, signal: input.signal },
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

  async function getGiftHistoryInternal(input = {}) {
    const pageToken =
      input.pageToken === null || input.pageToken === undefined
        ? null
        : input.pageToken;
    if (
      pageToken !== null &&
      (typeof pageToken !== 'string' || !pageToken || pageToken.length > 4096)
    ) {
      throw new RemoteLicenseError(
        'INVALID_BOOTSTRAP_TOKEN',
        '礼物历史页令牌无效。',
      );
    }
    return withAuthorizedToken(
      async (token) => {
        const result = await remote.getGiftHistory(pageToken, token, {
          signal: input.signal,
        });
        try {
          return normalizeProcessedGiftHistoryPage(result);
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

  async function clearGiftHistoryInternal(input = {}) {
    return withAuthorizedToken(
      async (token) => {
        const result = await remote.clearGiftHistory(token, {
          signal: input.signal,
        });
        const deletedCounts = result?.deletedCounts;
        const syncEpoch = result?.syncEpoch;
        if (
          result?.ok !== true ||
          !deletedCounts ||
          !Number.isSafeInteger(deletedCounts.giftEvents) ||
          deletedCounts.giftEvents < 0 ||
          !Number.isSafeInteger(deletedCounts.giftEventDeliveries) ||
          deletedCounts.giftEventDeliveries < 0 ||
          typeof syncEpoch !== 'string' ||
          !syncEpoch ||
          syncEpoch.length > 128
        ) {
          throw new RemoteLicenseError(
            'INVALID_RESPONSE',
            '授权服务器返回无效响应。',
            { retryable: true },
          );
        }
        return {
          ok: true,
          deletedCounts: {
            giftEvents: deletedCounts.giftEvents,
            giftEventDeliveries: deletedCounts.giftEventDeliveries,
          },
          syncEpoch,
        };
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

  async function updateCloudSettings(settings, requestOptions = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new RemoteLicenseError(
        'INVALID_SYNC_SETTINGS',
        '云端同步设置格式无效。',
      );
    }
    return withAuthorizedToken((token) =>
      remote.updateCloudSettings(settings, token, requestOptions),
    );
  }

  async function getBilibiliCredentialsInternal(requestOptions = {}) {
    return withAuthorizedSecret((token) =>
      remote.getBilibiliCredentials(token, requestOptions),
    );
  }

  async function setBilibiliCredentialsInternal(cookie, requestOptions = {}) {
    const value = String(cookie || '').trim();
    if (!value || value.length > 12_000 || /[\r\n\0]/u.test(value)) {
      throw new RemoteLicenseError(
        'BILIBILI_CREDENTIALS_INVALID',
        '直播账号登录凭据无效。',
      );
    }
    return withAuthorizedToken((token) =>
      remote.setBilibiliCredentials(value, token, requestOptions),
    );
  }

  async function clearBilibiliCredentialsInternal(requestOptions = {}) {
    return withAuthorizedToken((token) =>
      remote.clearBilibiliCredentials(token, requestOptions),
    );
  }

  async function syncSongs(songs, requestOptions = {}) {
    if (!Array.isArray(songs) || songs.length > 5000)
      throw new RemoteLicenseError(
        'SONG_LIST_INVALID',
        '歌库数量超出同步上限。',
      );
    return withAuthorizedToken((token) =>
      remote.syncSongs(songs.map(mapSongForSync), token, requestOptions),
    );
  }

  async function getCloudSongs(requestOptions = {}) {
    return withAuthorizedToken((token) =>
      remote.getCloudSongs(token, requestOptions),
    );
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
    getGiftCardProfilesInternal: (input = {}) => withAuthorizedToken((token) =>
      remote.getGiftCardProfiles(input.cursor, token, { signal: input.signal })),
    getFanFactsInternal: (input = {}) => withAuthorizedToken((token) =>
      remote.getFanFacts(input.after || 0, input.epoch, token, { signal: input.signal })),
    clearBilibiliCredentialsInternal,
    clearGiftHistoryInternal,
    deleteSongPageBackground,
    getBilibiliCredentialsInternal,
    getCloudSongs,
    getCloudState,
    getGiftCatalog,
    getGiftEventsInternal,
    getGiftHistoryInternal,
    getProfile,
    getOverlaySettings,
    updateOverlaySettings,
    getOverlayFilters,
    updateOverlayFilters,
    getOverlayViewers,
    getWelcomeSettings,
    dailyBotRequestInternal,
    getWelcomeSettingsV2,
    updateWelcomeSettingsV2,
    getPkReportSettings,
    updatePkReportSettings,
    updateWelcomeSettings,
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
