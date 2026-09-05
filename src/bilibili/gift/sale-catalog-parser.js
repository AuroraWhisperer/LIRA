'use strict';

const { isGuardGiftAliasId } = require('./guard-gift-aliases');

const EXCLUDED_GIFT_IDS = new Set([13000]);

function collectPanelGiftIds(payload) {
  const ids = new Set();
  const data = payload?.data || {};
  const roomList = data.room_gift_list || {};
  addGiftEntries(ids, roomList.gold_list);
  addGiftEntries(ids, roomList.silver_list);
  for (const tab of Array.isArray(data.tab_list) ? data.tab_list : []) {
    addGiftEntries(ids, tab?.list);
  }
  addGiftEntries(ids, data.special_show_gift);
  visitGiftContainer(ids, data.discount_gift_list);
  return ids;
}

function addGiftEntries(ids, entries) {
  for (const entry of Array.isArray(entries) ? entries : [])
    addGiftEntry(ids, entry);
}

function addGiftEntry(ids, entry) {
  const id = Number(entry?.gift_id ?? entry?.id);
  if (Number.isSafeInteger(id) && id > 0 && !isExcludedGiftId(id)) ids.add(id);
  addGiftEntries(ids, entry?.upgrade_gift);
}

function visitGiftContainer(ids, value) {
  if (Array.isArray(value)) {
    addGiftEntries(ids, value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Object.hasOwn(value, 'gift_id')) addGiftEntry(ids, value);
  for (const child of Object.values(value)) visitGiftContainer(ids, child);
}

function parseGiftConfig(payload) {
  const result = new Map();
  const list = payload?.data?.list;
  if (!Array.isArray(list)) return result;
  for (const entry of list) {
    const id = Number(entry?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const price = Math.max(0, Number(entry?.price) || 0);
    result.set(
      id,
      Object.freeze({
        id,
        name:
          String(entry?.name || `礼物 ${id}`)
            .trim()
            .slice(0, 100) || `礼物 ${id}`,
        battery: price / 100,
        rmb: price / 1000,
        bagGift: Boolean(entry?.bag_gift),
        coinType: String(entry?.coin_type || ''),
        sourceUrl: normalizeBilibiliImageUrl(entry?.webp || entry?.img_basic),
      }),
    );
  }
  return result;
}

function expandBlindBoxSaleIds(panelSaleIds, configById, rawConfig) {
  const saleIds = new Set(panelSaleIds);
  const blindBoxes = parseBlindBoxConfig(rawConfig);
  if (blindBoxes.length === 0) return saleIds;

  const giftsByName = new Map();
  for (const gift of configById.values()) {
    const name = normalizeGiftName(gift.name);
    if (!name) continue;
    if (!giftsByName.has(name)) giftsByName.set(name, []);
    giftsByName.get(name).push(gift);
  }
  for (const candidates of giftsByName.values()) {
    candidates.sort(
      (left, right) =>
        Number(left.bagGift) - Number(right.bagGift) || left.id - right.id,
    );
  }

  const panelGiftNames = new Set(
    [...panelSaleIds]
      .map((id) => normalizeGiftName(configById.get(id)?.name))
      .filter(Boolean),
  );
  for (const box of blindBoxes) {
    if (!panelGiftNames.has(box.name)) continue;
    for (const output of box.outputs) {
      const candidates = giftsByName.get(output.name) || [];
      const priceMatches =
        output.rmb === null
          ? candidates
          : candidates.filter(
              (gift) => Math.abs(gift.rmb - output.rmb) < 0.001,
            );
      const gift = priceMatches[0] || candidates[0];
      if (gift && !isExcludedGiftId(gift.id)) saleIds.add(gift.id);
    }
  }
  return saleIds;
}

function parseBlindBoxConfig(value) {
  let boxes = value;
  if (typeof boxes === 'string') {
    try {
      boxes = JSON.parse(boxes);
    } catch (_) {
      boxes = [];
    }
  }
  if (!Array.isArray(boxes)) return [];
  return boxes
    .map((box) => ({
      name: normalizeGiftName(box?.name),
      outputs: (Array.isArray(box?.outputs) ? box.outputs : [])
        .map((output) => {
          if (output && typeof output === 'object') {
            const price = Number(output.price);
            return {
              name: normalizeGiftName(output.name),
              rmb: Number.isFinite(price) && price >= 0 ? price : null,
            };
          }
          return { name: normalizeGiftName(output), rmb: null };
        })
        .filter((output) => output.name),
    }))
    .filter((box) => box.name && box.outputs.length > 0);
}

function normalizeGiftName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBilibiliImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      !(hostname === 'hdslb.com' || hostname.endsWith('.hdslb.com'))
    )
      return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function buildGiftCatalog(saleIds, configById) {
  return [...saleIds]
    .filter((id) => !isExcludedGiftId(id))
    .map((id) => {
      const metadata = configById.get(id);
      return {
        known: Boolean(metadata),
        id: String(id),
        name: metadata?.name || `礼物 ${id}`,
        battery: finiteNonNegative(metadata?.battery),
        rmb: finiteNonNegative(metadata?.rmb),
        imagePath: '',
      };
    })
    .sort(
      (left, right) =>
        Number(right.known) - Number(left.known) ||
        left.rmb - right.rmb ||
        Number(left.id) - Number(right.id),
    )
    .map(({ known: _known, ...gift }) => gift);
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function isExcludedGiftId(value) {
  const id = Number(value);
  return EXCLUDED_GIFT_IDS.has(id) || isGuardGiftAliasId(id);
}

module.exports = {
  EXCLUDED_GIFT_IDS,
  buildGiftCatalog,
  collectPanelGiftIds,
  expandBlindBoxSaleIds,
  finiteNonNegative,
  isExcludedGiftId,
  parseGiftConfig,
};
