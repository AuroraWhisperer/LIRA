'use strict';

const { giftVariantId } = require('../../shared/gift-identity');

function mergeVariantRoomCatalog(room, server, customBoxes) {
  const byVariant = new Map();
  const customVariants = new Map();
  for (const gift of server.gifts) {
    byVariant.set(gift.variantId, gift);
    if (customBoxes.length) {
      const key = JSON.stringify([gift.id, gift.name, gift.priceRaw]);
      customVariants.set(key, customVariants.has(key) ? null : gift.variantId);
    }
  }
  const gifts = (room?.gifts || []).map((gift) => {
    const variantId = giftVariantId(gift);
    const archived = byVariant.get(variantId);
    if (archived) return { ...gift, ...archived };
    const { variantId: _variantId, giftIdentity: _giftIdentity, giftCategory: _giftCategory, ...unresolved } = gift;
    return { ...unresolved, imagePath: '', sourceUrl: '' };
  });
  const selected = new Set(gifts.map((gift) => gift.variantId).filter(Boolean));
  const addVariant = (variantId) => {
    const gift = byVariant.get(variantId);
    if (!gift || selected.has(variantId)) return;
    selected.add(variantId);
    gifts.push({ ...gift });
  };
  for (const box of server.variantBlindBoxes || []) {
    if (!selected.has(box.variantId)) continue;
    for (const output of box.outputVariantIds) addVariant(output);
  }
  // Tenant entries have name and list price evidence, not just an ID.
  const findCustom = (item) => customVariants.get(
    JSON.stringify([String(item?.giftId), item?.name, Math.round(Number(item?.price) * 1000)]),
  ) ?? null;
  for (const box of customBoxes) {
    if (!selected.has(findCustom(box))) continue;
    for (const output of box.outputs || []) addVariant(findCustom(output));
  }
  return { ...room, count: gifts.length, gifts };
}

module.exports = { mergeVariantRoomCatalog };
