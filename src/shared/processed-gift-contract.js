'use strict';

const MAX_PAGE_SIZE = 200;
const MAX_PAGE_TOKEN_LENGTH = 4096;
const MAX_EPOCH_LENGTH = 128;
const HISTORY_BOOTSTRAP_VERSION = 1;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const EVENT_KEYS = Object.freeze(['eventId', 'cursor', 'phase', 'gift']);
const HISTORY_RECORD_KEYS = Object.freeze(['eventId', 'gift']);
const GIFT_KEYS = Object.freeze([
  'giftId',
  'giftName',
  'userName',
  'num',
  'unitPrice',
  'totalPrice',
  'coinType',
  'isBlindBox',
  'blindBoxName',
  'blindBoxPrice',
  'blindProfit',
  'createdAt',
]);
const HISTORY_PAGE_KEYS = Object.freeze([
  'ok',
  'events',
  'nextPageToken',
  'hasMore',
  'recoveryCursor',
  'syncEpoch',
  'historyBootstrapVersion',
]);
const LEGACY_PAGE_KEYS = Object.freeze([
  'ok',
  'events',
  'nextCursor',
  'hasMore',
]);
const EVENT_PAGE_KEYS = Object.freeze([
  ...LEGACY_PAGE_KEYS,
  'historyBootstrapVersion',
  'syncEpoch',
  'earliestCursor',
  'latestCursor',
]);

function normalizeProcessedGiftEvent(input) {
  validateProcessedGiftEventWire(input, invalidEvent);
  return canonicalizeProcessedGiftEvent(input);
}

function canonicalizeProcessedGiftEvent(input) {
  if (!isPlainObject(input)) throw invalidEvent();
  const eventId = normalizeEventId(input.eventId, invalidEvent);
  const phase = String(input.phase || '').trim();
  if (phase !== 'progress' && phase !== 'final') throw invalidEvent();
  const cursor = input.cursor;
  if (
    (phase === 'progress' && cursor !== null && cursor !== undefined) ||
    (phase === 'final' && !isPositiveSafeInteger(cursor))
  ) {
    throw invalidEvent();
  }
  return Object.freeze({
    eventId,
    phase,
    cursor: phase === 'final' ? Number(cursor) : null,
    gift: canonicalizeGiftDisplay(input.gift, invalidEvent),
  });
}

function normalizeProcessedGiftPage(input) {
  const isLegacyPage =
    isPlainObject(input) && hasExactKeys(input, LEGACY_PAGE_KEYS);
  const isVersionedPage =
    isPlainObject(input) && hasExactKeys(input, EVENT_PAGE_KEYS);
  if ((!isLegacyPage && !isVersionedPage) || input.ok !== true) {
    throw invalidPage();
  }
  const events = Array.isArray(input.events) ? input.events : null;
  const nextCursor = input.nextCursor;
  if (
    !events ||
    events.length > MAX_PAGE_SIZE ||
    !Number.isSafeInteger(nextCursor) ||
    nextCursor < 0 ||
    typeof input.hasMore !== 'boolean'
  ) {
    throw invalidPage();
  }
  let normalized;
  try {
    normalized = events.map(normalizeProcessedGiftEvent);
  } catch {
    throw invalidPage();
  }
  if (normalized.some((event) => event.phase !== 'final')) {
    throw invalidPage();
  }
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].cursor <= normalized[index - 1].cursor) {
      throw invalidPage();
    }
  }
  if (
    normalized.length > 0 &&
    normalized[normalized.length - 1].cursor !== nextCursor
  ) {
    throw invalidPage();
  }
  const syncMetadata = isVersionedPage
    ? normalizeRequiredSyncMetadata(input, invalidPage)
    : {};
  return Object.freeze({
    ok: true,
    events: Object.freeze(normalized),
    nextCursor,
    hasMore: input.hasMore,
    ...syncMetadata,
  });
}

function normalizeProcessedGiftHistoryRecord(input) {
  validateProcessedGiftHistoryRecordWire(input, invalidHistoryRecord);
  return canonicalizeProcessedGiftHistoryRecord(input);
}

function canonicalizeProcessedGiftHistoryRecord(input) {
  if (!isPlainObject(input)) {
    throw invalidHistoryRecord();
  }
  try {
    return Object.freeze({
      eventId: normalizeEventId(input.eventId, invalidHistoryRecord),
      gift: canonicalizeGiftDisplay(input.gift, invalidHistoryRecord),
    });
  } catch {
    throw invalidHistoryRecord();
  }
}

function normalizeProcessedGiftHistoryPage(input) {
  if (
    !isPlainObject(input) ||
    !hasExactKeys(input, HISTORY_PAGE_KEYS) ||
    input.ok !== true ||
    input.historyBootstrapVersion !== HISTORY_BOOTSTRAP_VERSION ||
    !Array.isArray(input.events) ||
    input.events.length > MAX_PAGE_SIZE ||
    typeof input.hasMore !== 'boolean'
  ) {
    throw invalidHistoryPage();
  }
  const nextPageToken = normalizePageToken(input.nextPageToken);
  if (
    nextPageToken === undefined ||
    (input.hasMore && !nextPageToken) ||
    (!input.hasMore && nextPageToken !== null)
  ) {
    throw invalidHistoryPage();
  }
  const recoveryCursor = input.recoveryCursor;
  if (!Number.isSafeInteger(recoveryCursor) || recoveryCursor < 0) {
    throw invalidHistoryPage();
  }
  let events;
  let syncEpoch;
  try {
    events = input.events.map(normalizeProcessedGiftHistoryRecord);
    syncEpoch = normalizeEpoch(input.syncEpoch, invalidHistoryPage);
  } catch {
    throw invalidHistoryPage();
  }
  return Object.freeze({
    ok: true,
    events: Object.freeze(events),
    nextPageToken,
    hasMore: input.hasMore,
    recoveryCursor,
    syncEpoch,
    historyBootstrapVersion: HISTORY_BOOTSTRAP_VERSION,
  });
}

function validateProcessedGiftEventWire(input, errorFactory) {
  if (!isPlainObject(input) || !hasExactKeys(input, EVENT_KEYS)) {
    throw errorFactory();
  }
  if (
    typeof input.eventId !== 'string' ||
    typeof input.phase !== 'string' ||
    (input.phase !== 'progress' && input.phase !== 'final') ||
    (input.phase === 'progress' && input.cursor !== null) ||
    (input.phase === 'final' && !isPositiveSafeInteger(input.cursor))
  ) {
    throw errorFactory();
  }
  validateGiftDisplayWire(input.gift, errorFactory);
}

function validateProcessedGiftHistoryRecordWire(input, errorFactory) {
  if (
    !isPlainObject(input) ||
    !hasExactKeys(input, HISTORY_RECORD_KEYS) ||
    typeof input.eventId !== 'string'
  ) {
    throw errorFactory();
  }
  validateGiftDisplayWire(input.gift, errorFactory);
}

function validateGiftDisplayWire(source, errorFactory) {
  if (!isPlainObject(source) || !hasExactKeys(source, GIFT_KEYS)) {
    throw errorFactory();
  }
  for (const key of [
    'giftId',
    'giftName',
    'userName',
    'coinType',
    'blindBoxName',
    'createdAt',
  ]) {
    if (typeof source[key] !== 'string') throw errorFactory();
  }
  if (
    !Number.isSafeInteger(source.num) ||
    source.num < 1 ||
    typeof source.unitPrice !== 'number' ||
    typeof source.totalPrice !== 'number' ||
    typeof source.isBlindBox !== 'boolean' ||
    (source.blindBoxPrice !== null &&
      typeof source.blindBoxPrice !== 'number') ||
    (source.blindProfit !== null && typeof source.blindProfit !== 'number')
  ) {
    throw errorFactory();
  }
}

function canonicalizeGiftDisplay(source, errorFactory) {
  if (!isPlainObject(source)) throw errorFactory();
  const giftId = boundedCanonicalText(
    canonicalGiftId(source.giftId),
    128,
    errorFactory,
  );
  const giftName = boundedCanonicalText(
    canonicalGiftText(source.giftName),
    100,
    errorFactory,
  );
  const userName =
    boundedCanonicalText(
      canonicalGiftText(source.userName),
      100,
      errorFactory,
    ) || '观众';
  const coinType = boundedCanonicalText(
    canonicalCoinType(source.coinType),
    32,
    errorFactory,
  );
  const num = source.num;
  const unitPriceCents = moneyToCents(source.unitPrice, false, errorFactory);
  const totalPriceCents = moneyToCents(
    source.totalPrice,
    false,
    errorFactory,
  );
  const createdAtMs = Date.parse(String(source.createdAt || ''));
  if (
    (!giftId && !giftName) ||
    !Number.isSafeInteger(num) ||
    num < 1 ||
    totalPriceCents <= 0 ||
    !Number.isFinite(createdAtMs)
  ) {
    throw errorFactory();
  }

  const isBlindBox = source.isBlindBox === true;
  let blindBoxName = '';
  let blindBoxPriceCents = null;
  let blindProfitCents = null;
  if (isBlindBox) {
    blindBoxName = boundedCanonicalText(
      canonicalGiftText(source.blindBoxName),
      100,
      errorFactory,
    );
    blindBoxPriceCents = nullableMoneyToCents(
      source.blindBoxPrice,
      false,
      errorFactory,
    );
    const suppliedProfitCents = nullableMoneyToCents(
      source.blindProfit,
      true,
      errorFactory,
    );
    blindProfitCents =
      blindBoxPriceCents === null
        ? null
        : totalPriceCents - blindBoxPriceCents;
    if (suppliedProfitCents !== blindProfitCents) throw errorFactory();
  } else if (
    canonicalGiftText(source.blindBoxName) ||
    (source.blindBoxPrice !== null && source.blindBoxPrice !== undefined) ||
    (source.blindProfit !== null && source.blindProfit !== undefined)
  ) {
    throw errorFactory();
  }

  return Object.freeze({
    giftId,
    giftName,
    userName,
    num,
    unitPrice: unitPriceCents / 100,
    unitPriceCents,
    totalPrice: totalPriceCents / 100,
    totalPriceCents,
    coinType,
    isBlindBox,
    blindBoxName,
    blindBoxPrice:
      blindBoxPriceCents === null ? null : blindBoxPriceCents / 100,
    blindBoxPriceCents,
    blindProfit: blindProfitCents === null ? null : blindProfitCents / 100,
    blindProfitCents,
    createdAt: new Date(createdAtMs).toISOString(),
  });
}

function normalizeRequiredSyncMetadata(input, errorFactory) {
  const historyBootstrapVersion = input.historyBootstrapVersion;
  const syncEpoch = input.syncEpoch;
  const earliestCursor = input.earliestCursor;
  const latestCursor = input.latestCursor;
  const version = historyBootstrapVersion;
  const earliest = earliestCursor;
  const latest = latestCursor;
  if (
    version !== HISTORY_BOOTSTRAP_VERSION ||
    !Number.isSafeInteger(earliest) ||
    earliest < 0 ||
    !Number.isSafeInteger(latest) ||
    latest < earliest
  ) {
    throw errorFactory();
  }
  return {
    historyBootstrapVersion: version,
    syncEpoch: normalizeEpoch(syncEpoch, errorFactory),
    earliestCursor: earliest,
    latestCursor: latest,
  };
}

function canonicalGiftId(value) {
  return String(value ?? '').trim().normalize('NFC');
}

function canonicalGiftText(value) {
  return String(value ?? '')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim()
    .normalize('NFC');
}

function canonicalCoinType(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFC');
}

function moneyToCents(value, signed, errorFactory) {
  const amount = value;
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(cents) ||
    Math.abs(scaled - cents) > 1e-7 ||
    (!signed && amount < 0)
  ) {
    throw errorFactory();
  }
  return Object.is(cents, -0) ? 0 : cents;
}

function nullableMoneyToCents(value, signed, errorFactory) {
  if (value === null || value === undefined) return null;
  return moneyToCents(value, signed, errorFactory);
}

function normalizeEventId(value, errorFactory) {
  const eventId = String(value || '').trim();
  if (!EVENT_ID_PATTERN.test(eventId)) throw errorFactory();
  return eventId;
}

function normalizeEpoch(value, errorFactory) {
  if (typeof value !== 'string') throw errorFactory();
  const epoch = value;
  if (!epoch || epoch.length > MAX_EPOCH_LENGTH) throw errorFactory();
  return epoch;
}

function normalizePageToken(value) {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAX_PAGE_TOKEN_LENGTH
  ) {
    return undefined;
  }
  return value;
}

function boundedCanonicalText(value, maxLength, errorFactory) {
  if (Array.from(value).length > maxLength) throw errorFactory();
  return value;
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) return false;
  return expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function invalidEvent() {
  return new Error('INVALID_PROCESSED_GIFT_EVENT');
}

function invalidPage() {
  return new Error('INVALID_PROCESSED_GIFT_PAGE');
}

function invalidHistoryRecord() {
  return new Error('INVALID_PROCESSED_GIFT_HISTORY_RECORD');
}

function invalidHistoryPage() {
  return new Error('INVALID_PROCESSED_GIFT_HISTORY_PAGE');
}

module.exports = {
  canonicalizeProcessedGiftEvent,
  canonicalizeProcessedGiftHistoryRecord,
  canonicalCoinType,
  canonicalGiftId,
  canonicalGiftText,
  normalizeProcessedGiftEvent,
  normalizeProcessedGiftHistoryPage,
  normalizeProcessedGiftHistoryRecord,
  normalizeProcessedGiftPage,
};
