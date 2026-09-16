'use strict';

const {
  createRemoteGiftCatalogCache: createRemoteGiftCatalogCacheImpl,
  normalizeRemoteCatalog: normalizeRemoteCatalogImpl,
} = require('../../src/bilibili/gift/remote-catalog-cache');

const QUIET_LOGGER = { debug() {}, warn() {} };
const UPDATED_AT = '2026-08-29T08:00:00.000Z';

function v2CatalogResponse(response) {
  if (!response || response.notModified === true || response.ok === false) {
    return response;
  }
  return {
    schemaVersion: 2,
    blindBoxes: [],
    ...response,
    gifts: (response.gifts || []).map((gift) => ({
      active: true,
      giftCategory: (response.blindBoxes || []).some(box => box.giftId === gift.id)
        ? 'blindBox' : (response.blindBoxes || []).some(box => box.outputGiftIds.includes(gift.id))
          ? 'blindBoxOutput' : 'directGift',
      ...gift,
    })),
  };
}

function createRemoteGiftCatalogCache(options) {
  const fetchRemote = options.fetchRemote;
  return createRemoteGiftCatalogCacheImpl({
    ...options,
    fetchRemote: async (request) =>
      v2CatalogResponse(await fetchRemote(request)),
  });
}

function normalizeRemoteCatalog(response, options) {
  return normalizeRemoteCatalogImpl(v2CatalogResponse(response), options);
}

module.exports = {
  QUIET_LOGGER,
  UPDATED_AT,
  createRemoteGiftCatalogCache,
  normalizeRemoteCatalog,
  v2CatalogResponse,
};
