export function giftSelectionKey(gift) {
  return (
    gift.giftIdentity?.variantId ||
    gift.variantId ||
    String(gift.giftId ?? gift.id)
  );
}

export function giftArtworkKey(gift) {
  return (
    gift.giftIdentity?.variantId ||
    gift.variantId ||
    JSON.stringify([
      String(gift.giftId ?? gift.id),
      String(gift.giftName ?? gift.name),
      gift.rmb ?? null,
    ])
  );
}

export function rowGiftIdentity(row) {
  return JSON.parse(row.dataset.giftIdentity || 'null');
}
