'use strict';

const crypto = require('node:crypto');

const VARIANT_ID = /^gv_[a-f0-9]{64}$/u;
const METADATA_INTEGERS = [
  'type',
  'giftType',
  'effect',
  'effectId',
  'comboResourcesId',
  'broadcast',
  'draw',
  'stayTime',
  'maxSendLimit',
  'privilegeRequired',
];

function record(value, required, optional = []) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}

function timestamp(value) {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        value,
      ) &&
      Number.isFinite(Date.parse(value)))
  );
}

function mediaUrl(value, imageOnly = false) {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      (imageOnly
        ? ['hdslb.com']
        : ['hdslb.com', 'bilibili.com', 'bilivideo.com']
      ).some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

function validEffect(effect) {
  if (effect === null) return true;
  if (
    !record(effect, [
      'effectKey',
      'sourceEffectId',
      'mp4Url',
      'layoutUrl',
      'fileSize',
      'layout',
    ]) ||
    typeof effect.effectKey !== 'string' ||
    !effect.effectKey ||
    !Number.isSafeInteger(effect.sourceEffectId) ||
    effect.sourceEffectId <= 0 ||
    !Number.isSafeInteger(effect.fileSize) ||
    effect.fileSize < 0 ||
    !effect.mp4Url ||
    !effect.layoutUrl ||
    !mediaUrl(effect.mp4Url) ||
    !mediaUrl(effect.layoutUrl)
  )
    return false;
  const layout = effect.layout;
  return (
    record(layout, ['videoWidth', 'videoHeight', 'rgbFrame', 'alphaFrame']) &&
    [layout.videoWidth, layout.videoHeight].every(
      (size) => Number.isSafeInteger(size) && size > 0 && size <= 8192,
    ) &&
    [layout.rgbFrame, layout.alphaFrame].every(
      (rect) =>
        Array.isArray(rect) &&
        rect.length === 4 &&
        rect.every((value) => Number.isSafeInteger(value) && value >= 0) &&
        rect[2] > 0 &&
        rect[3] > 0 &&
        rect[0] + rect[2] <= layout.videoWidth &&
        rect[1] + rect[3] <= layout.videoHeight,
    )
  );
}

function validMetadata(item) {
  const metadata = item.metadata;
  if (
    !record(
      metadata,
      [
        'id',
        'name',
        'price',
        'coinType',
        'bagGift',
        'desc',
        'webpUrl',
        'mp4Url',
        'layoutUrl',
      ],
      [...METADATA_INTEGERS, 'rule', 'rights', 'countMap'],
    ) ||
    metadata.id !== Number(item.giftId) ||
    metadata.name !== item.name ||
    metadata.price !== item.priceRaw ||
    metadata.coinType !== item.coinType ||
    metadata.bagGift !== item.bagGift ||
    metadata.desc !== item.desc ||
    metadata.webpUrl !== item.sourceUrl ||
    metadata.mp4Url !== (item.effect?.mp4Url ?? null) ||
    metadata.layoutUrl !== (item.effect?.layoutUrl ?? null)
  )
    return false;
  return (
    METADATA_INTEGERS.every(
      (key) =>
        !Object.hasOwn(metadata, key) ||
        (Number.isSafeInteger(metadata[key]) && metadata[key] >= 0),
    ) &&
    ['rule', 'rights'].every(
      (key) =>
        !Object.hasOwn(metadata, key) ||
        (typeof metadata[key] === 'string' && metadata[key].length > 0),
    ) &&
    (!Object.hasOwn(metadata, 'countMap') ||
      (Array.isArray(metadata.countMap) &&
        metadata.countMap.length > 0 &&
        metadata.countMap.every(
          (entry) =>
            record(entry, ['num'], ['text', 'desc', 'effectId']) &&
            Number.isSafeInteger(entry.num) &&
            entry.num > 0 &&
            ['text', 'desc'].every(
              (key) =>
                !Object.hasOwn(entry, key) ||
                (typeof entry[key] === 'string' && entry[key].length > 0),
            ) &&
            (!Object.hasOwn(entry, 'effectId') ||
              (Number.isSafeInteger(entry.effectId) && entry.effectId >= 0)),
        )))
  );
}

function validAward(item) {
  return (
    record(item, [
      'awardId',
      'contentType',
      'level',
      'name',
      'valueRmb',
      'imageUrl',
      'probabilities',
    ]) &&
    typeof item.awardId === 'string' &&
    /^[0-9]{1,32}$/u.test(item.awardId) &&
    item.contentType === 97 &&
    [1, 2, 3].includes(item.level) &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    Number.isFinite(item.valueRmb) &&
    item.valueRmb > 0 &&
    /^https:\/\/i0\.hdslb\.com\/bfs\/live\/[0-9a-f]+\.png$/u.test(
      item.imageUrl,
    ) &&
    record(item.probabilities, ['base', 'bonus1', 'bonus2', 'bonus3']) &&
    Object.values(item.probabilities).every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    )
  );
}

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function validateVariantCatalog(value) {
  if (
    !record(value, [
      'ok',
      'schemaVersion',
      'catalog',
      'version',
      'updatedAt',
      'versionLabel',
      'stale',
      'sources',
      'count',
      'variantCount',
      'variants',
      'blindBoxes',
    ]) ||
    value.ok !== true ||
    value.schemaVersion !== 3 ||
    value.catalog !== 'all' ||
    typeof value.stale !== 'boolean' ||
    !timestamp(value.updatedAt) ||
    !(
      value.versionLabel === null ||
      (typeof value.versionLabel === 'string' &&
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value.versionLabel))
    ) ||
    !record(value.sources, ['gifts', 'effects']) ||
    !Object.values(value.sources).every(
      (source) =>
        record(source, ['asOf', 'stale']) &&
        timestamp(source.asOf) &&
        typeof source.stale === 'boolean',
    ) ||
    !Array.isArray(value.variants) ||
    !value.variants.length ||
    value.variants.length > 10000 ||
    !Array.isArray(value.blindBoxes) ||
    value.variantCount !== value.variants.length ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.version)
  )
    throw new Error('CATALOG_INVALID');
  const byId = new Map();
  for (const item of value.variants) {
    if (
      !record(item, [
        'variantId',
        'giftId',
        'name',
        'priceRaw',
        'battery',
        'rmb',
        'silver',
        'coinType',
        'bagGift',
        'sourceUrl',
        'imageUrl',
        'isProjected',
        'isBlindBox',
        'desc',
        'metadata',
        'effect',
        'firstSeenAt',
        'lastSeenAt',
        'firstSeenRunId',
        'lastSeenRunId',
      ]) ||
      !VARIANT_ID.test(item.variantId) ||
      byId.has(item.variantId) ||
      typeof item.giftId !== 'string' ||
      !/^[1-9]\d{0,19}$/u.test(item.giftId) ||
      !Number.isSafeInteger(Number(item.giftId)) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      [...item.name].length > 100 ||
      !Number.isSafeInteger(item.priceRaw) ||
      item.priceRaw < 0 ||
      !['gold', 'silver'].includes(item.coinType) ||
      typeof item.bagGift !== 'boolean' ||
      typeof item.isBlindBox !== 'boolean' ||
      typeof item.isProjected !== 'boolean' ||
      typeof item.desc !== 'string' ||
      !mediaUrl(item.sourceUrl, true) ||
      item.imageUrl !== null ||
      !validEffect(item.effect) ||
      !validMetadata(item) ||
      !timestamp(item.firstSeenAt) ||
      !timestamp(item.lastSeenAt) ||
      ![item.firstSeenRunId, item.lastSeenRunId].every(
        (id) =>
          id === null || (typeof id === 'string' && /^[1-9]\d*$/u.test(id)),
      ) ||
      item.battery !==
        (item.coinType === 'gold' ? item.priceRaw / 100 : null) ||
      item.rmb !== (item.coinType === 'gold' ? item.priceRaw / 1000 : null) ||
      item.silver !==
        (item.coinType === 'silver' && item.priceRaw > 0
          ? item.priceRaw / 1000
          : null)
    )
      throw new Error('CATALOG_INVALID');
    byId.set(item.variantId, item);
  }
  if (
    new Set(value.variants.map((item) => item.giftId)).size !== value.count ||
    value.blindBoxes.length > 100
  )
    throw new Error('CATALOG_INVALID');
  const boxes = new Set();
  for (const relation of value.blindBoxes) {
    if (
      !record(relation, ['variantId', 'outputVariantIds', 'awards']) ||
      boxes.has(relation.variantId) ||
      byId.get(relation.variantId)?.coinType !== 'gold' ||
      !Array.isArray(relation.outputVariantIds) ||
      relation.outputVariantIds.length > 200 ||
      !Array.isArray(relation.awards) ||
      !relation.awards.every(validAward) ||
      new Set(relation.awards.map((item) => item.awardId)).size !==
        relation.awards.length ||
      (!relation.outputVariantIds.length && !relation.awards.length) ||
      new Set(relation.outputVariantIds).size !==
        relation.outputVariantIds.length ||
      relation.outputVariantIds.some(
        (id) => id === relation.variantId || byId.get(id)?.coinType !== 'gold',
      )
    )
      throw new Error('CATALOG_INVALID');
    boxes.add(relation.variantId);
  }
  const identities = value.variants.map((item) =>
    digest([
      item.giftId,
      item.name
        .normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/[A-Z]/gu, (letter) => letter.toLowerCase()),
      item.priceRaw,
      item.coinType,
      item.bagGift,
    ]),
  );
  if (
    value.variants.some(
      (item, index) => item.variantId !== `gv_${identities[index]}`,
    )
  )
    throw new Error('CATALOG_INVALID');
  const variants = value.variants.map(
    ({ firstSeenAt, lastSeenAt, firstSeenRunId, lastSeenRunId, ...item }) =>
      item,
  );
  const hash = digest({ variants, blindBoxes: value.blindBoxes });
  if (value.version !== `sha256:${hash}`) throw new Error('CATALOG_INVALID');
  return value;
}

module.exports = { validateVariantCatalog };
