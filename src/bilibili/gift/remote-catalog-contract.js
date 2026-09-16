'use strict';

const { isGuardGiftAliasId } = require('./guard-gift-aliases');
const { normalizeVariantSnapshot } = require('./variant-catalog-snapshot');
const { giftVariantId } = require('../../shared/gift-identity');
const {
  normalizeImageBaseUrl,
  normalizeBilibiliImageUrl,
  normalizeImagePath,
} = require('./remote-catalog-image-policy');

const MAX_GIFTS = 10000;
const MAX_BLIND_BOXES = 100;
const MAX_OUTPUTS_PER_BLIND_BOX = 200;
const MAX_TEXT_LENGTH = 256;
const EXCLUDED_GIFT_IDS = new Set(['13000']);

function normalizeRemoteCatalog(response, options = {}) {
  const source = readRemoteCatalogSource(response);
  if (source.schemaVersion === 3) {
    return normalizeVariantSnapshot(
      source,
      normalizeRemoteGift,
      normalizeImageBaseUrl(options.imageBaseUrl),
    );
  }
  if (source.schemaVersion !== 2 || !Array.isArray(source.blindBoxes)) {
    throw catalogError('REMOTE_CATALOG_SCHEMA_UNSUPPORTED');
  }
  const gifts = normalizeLegacyGifts(source.gifts, options.imageBaseUrl);
  const blindBoxes = normalizeBlindBoxes(source.blindBoxes, gifts);
  const outputs = new Set(blindBoxes.flatMap(box => box.outputGiftIds));
  if (gifts.some(gift => gift.giftCategory !== 'blindBox' &&
      (gift.giftCategory === 'blindBoxOutput') !== outputs.has(gift.id)))
    throw catalogError('REMOTE_CATALOG_BLIND_BOXES_INVALID');
  const version = safeText(source.version || source.revision, MAX_TEXT_LENGTH);
  if (!version) throw catalogError('REMOTE_CATALOG_VERSION_MISSING');
  const updatedAt =
    validIso(source.updatedAt || source.refreshedAt) ||
    isoTime(options.now || Date.now());
  const sources = normalizeSources(source.sources);
  return {
    schemaVersion: 2,
    source: 'server',
    roomId: '',
    panelCount: gifts.length,
    version,
    refreshedAt: updatedAt,
    updatedAt,
    stale:
      parseBooleanLike(source.stale) ||
      sources.gifts.stale ||
      sources.effects.stale,
    sources,
    count: gifts.length,
    gifts,
    blindBoxes,
  };
}

function readRemoteCatalogSource(response) {
  if (response?.ok === false) {
    throw catalogError(
      String(response.error || response.code || 'REMOTE_CATALOG_INVALID'),
    );
  }
  const nested =
    response?.data &&
    response?.gifts == null &&
    typeof response.data === 'object' &&
    !Array.isArray(response.data)
      ? response.data
      : null;
  const source = nested ? nested : response;
  if (!source || source.ok === false) {
    throw catalogError(String(source?.error || 'REMOTE_CATALOG_INVALID'));
  }
  return source;
}

function normalizeLegacyGifts(value, imageBaseUrl) {
  const rawGifts = Array.isArray(value) ? value : [];
  if (rawGifts.length === 0) throw catalogError('REMOTE_CATALOG_EMPTY');
  if (rawGifts.length > MAX_GIFTS)
    throw catalogError('REMOTE_CATALOG_TOO_LARGE');
  // The server origin is supplied by the composition root (the configured
  // license API base).  Never trust an origin echoed inside the response;
  // accepting it would let a proxy redirect image requests to an arbitrary
  // HTTPS host when this normalizer is used without an explicit base.
  const configuredImageBaseUrl = normalizeImageBaseUrl(imageBaseUrl);
  const gifts = [];
  const seenIds = new Set();
  for (const rawGift of rawGifts) {
    const gift = normalizeRemoteGift(rawGift, configuredImageBaseUrl);
    if (!gift) throw catalogError('REMOTE_CATALOG_GIFT_INVALID');
    if (seenIds.has(gift.id))
      throw catalogError('REMOTE_CATALOG_DUPLICATE_GIFT');
    seenIds.add(gift.id);
    if (
      gift.coinType === 'gold' &&
      !EXCLUDED_GIFT_IDS.has(gift.id) &&
      !isGuardGiftAliasId(gift.id)
    ) {
      gifts.push(gift);
    }
  }
  if (gifts.length === 0) throw catalogError('REMOTE_CATALOG_EMPTY');
  return gifts;
}

function normalizeRemoteGift(value, imageBaseUrl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const identity = normalizeRemoteGiftIdentity(value);
  if (!identity) return null;
  const { id, name, priceRaw, coinType, bagGift, variantId } = identity;
  return {
    id,
    name,
    battery: normalizeGiftAmount(value.battery, priceRaw, coinType, 100),
    ...(variantId
      ? { variantId, giftIdentity: { variantId, priceRaw, coinType, bagGift } }
      : {}),
    rmb: normalizeGiftAmount(value.rmb, priceRaw, coinType, 1000),
    priceRaw,
    coinType,
    bagGift,
    active: value.active,
    giftCategory: value.giftCategory,
    sourceUrl: normalizeBilibiliImageUrl(
      value.sourceUrl ?? value.source_url ?? value.imageSourceUrl,
    ),
    imagePath: normalizeImagePath(
      value.imagePath || value.imageUrl,
      imageBaseUrl,
    ),
  };
}

function normalizeRemoteGiftIdentity(value) {
  const rawId = String(value.id ?? value.giftId ?? value.gift_id ?? '').trim();
  if (!/^\d{1,20}$/u.test(rawId)) return null;
  const id = rawId.replace(/^0+(?=\d)/u, '');
  try {
    if (BigInt(id) <= 0n) return null;
  } catch (_) {
    return null;
  }
  const name =
    safeText(value.name ?? value.displayName ?? value.giftName, 100) ||
    `礼物 ${id}`;
  const priceRaw = strictNonNegativeInteger(value.priceRaw ?? value.price_raw);
  const coinType = safeText(value.coinType ?? value.coin_type, 32);
  if (
    priceRaw === null ||
    !coinType ||
    typeof value.active !== 'boolean' ||
    !['directGift', 'blindBox', 'blindBoxOutput'].includes(value.giftCategory) ||
    Object.hasOwn(value, 'isBlindBox')
  ) {
    return null;
  }
  const bagGift = parseBooleanLike(value.bagGift ?? value.bag_gift);
  const variantId = giftVariantId({ id, name, priceRaw, coinType, bagGift });
  return { id, name, priceRaw, coinType, bagGift, variantId };
}

function normalizeGiftAmount(value, priceRaw, coinType, units) {
  if (value != null) return finiteNonNegative(value);
  return coinType === 'gold' ? priceRaw / units : null;
}

function normalizeBlindBoxes(value, gifts) {
  if (!Array.isArray(value) || value.length > MAX_BLIND_BOXES) {
    throw catalogError('REMOTE_CATALOG_BLIND_BOXES_INVALID');
  }
  const giftById = new Map(gifts.map((gift) => [gift.id, gift]));
  const seenBoxIds = new Set();
  return value.map((entry) => {
    const giftId = normalizeGiftId(entry?.giftId);
    if (
      !giftId ||
      seenBoxIds.has(giftId) ||
      giftById.get(giftId)?.giftCategory !== 'blindBox' ||
      !Array.isArray(entry?.outputGiftIds) ||
      entry.outputGiftIds.length === 0 ||
      entry.outputGiftIds.length > MAX_OUTPUTS_PER_BLIND_BOX
    ) {
      throw catalogError('REMOTE_CATALOG_BLIND_BOXES_INVALID');
    }
    seenBoxIds.add(giftId);
    const outputGiftIds = entry.outputGiftIds.map(normalizeGiftId);
    if (
      outputGiftIds.some((id) => !id || id === giftId || !giftById.has(id)) ||
      new Set(outputGiftIds).size !== outputGiftIds.length
    ) {
      throw catalogError('REMOTE_CATALOG_BLIND_BOXES_INVALID');
    }
    return { giftId, outputGiftIds };
  });
}

function normalizeGiftId(value) {
  const id = String(value ?? '').trim();
  if (!/^[1-9]\d{0,19}$/u.test(id)) return '';
  try {
    return BigInt(id) > 0n ? id : '';
  } catch (_) {
    return '';
  }
}

function normalizeSources(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    gifts: normalizeSource(source.gifts),
    effects: normalizeSource(source.effects),
  };
}

function normalizeSource(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    asOf: validIso(source.asOf) || null,
    stale: parseBooleanLike(source.stale),
  };
}

function parseBooleanLike(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined)
    return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function catalogError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function strictNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeText(value, maxLength) {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength);
}

function validIso(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isoTime(value) {
  return new Date(Number(value) || Date.now()).toISOString();
}

module.exports = {
  normalizeRemoteCatalog,
  normalizeRemoteGift,
  catalogError,
  validIso,
  isoTime,
};
