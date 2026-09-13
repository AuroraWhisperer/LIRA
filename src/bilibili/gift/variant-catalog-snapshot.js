'use strict';

const { validateVariantCatalog } = require('./variant-catalog-contract');
const { isGuardGiftAliasId } = require('./guard-gift-aliases');

function normalizeVariantSnapshot(source, normalizeGift, imageBaseUrl) {
  const rawCatalog = Object.fromEntries([
    'ok', 'schemaVersion', 'catalog', 'version', 'updatedAt', 'versionLabel',
    'stale', 'sources', 'count', 'variantCount', 'variants', 'blindBoxes',
  ].map(key => [key, source[key]]));
  validateVariantCatalog(rawCatalog);
  const gifts = source.variants
    .filter(gift => gift.coinType === 'gold' && gift.giftId !== '13000' && !isGuardGiftAliasId(gift.giftId))
    .map(gift => ({
      ...normalizeGift({ ...gift, active: gift.isProjected }, imageBaseUrl),
      variantId: gift.variantId,
      giftIdentity: { variantId: gift.variantId, priceRaw: gift.priceRaw,
        coinType: gift.coinType, bagGift: gift.bagGift },
      effect: gift.effect,
    }));
  const byVariant = new Map(gifts.map(gift => [gift.variantId, gift]));
  // Legacy blind-box consumers receive only the current exact projections.
  const blindBoxes = source.blindBoxes.filter(box => byVariant.get(box.variantId)?.active)
    .map(box => ({ giftId: byVariant.get(box.variantId).id,
      outputGiftIds: box.outputVariantIds.filter(id => byVariant.get(id)?.active)
        .map(id => byVariant.get(id).id) })).filter(box => box.outputGiftIds.length);
  return { schemaVersion: 3, source: 'server', roomId: '', panelCount: gifts.length,
    version: source.version, refreshedAt: source.updatedAt, updatedAt: source.updatedAt,
    stale: source.stale, sources: source.sources, count: gifts.length, gifts,
    blindBoxes, variantBlindBoxes: source.blindBoxes, rawCatalog };
}

module.exports = { normalizeVariantSnapshot };
