'use strict';

// Display labels only. Received gifts keep the server's classification and value.
export function createGiftCatalogRoleLookup(snapshot) {
  if (!Array.isArray(snapshot?.gifts) || !Array.isArray(snapshot?.blindBoxes))
    return () => '';
  const gifts = new Map(snapshot.gifts.map(gift => [String(gift.id), gift]));
  const parents = new Map();
  for (const box of snapshot.blindBoxes) {
    const name = gifts.get(String(box.giftId))?.name;
    if (!name) continue;
    for (const id of box.outputGiftIds) {
      if (!parents.has(String(id))) parents.set(String(id), new Set());
      parents.get(String(id)).add(name);
    }
  }
  const labels = new Map(snapshot.gifts.map(gift => {
    const sources = [...(parents.get(String(gift.id)) || [])];
    const label = gift.isBlindBox ? '盲盒本体'
      : sources.length ? `盲盒产物 · ${sources.join(' / ')}` : '常规直送礼物';
    return [catalogIdentity(gift), label];
  }));
  return gift => labels.get(catalogIdentity(gift)) || '';
}

function catalogIdentity(gift) {
  return JSON.stringify([String(gift.id), String(gift.name), Number(gift.rmb)]);
}
