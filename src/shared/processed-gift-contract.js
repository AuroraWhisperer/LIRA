'use strict';

function normalizeProcessedGiftEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidEvent();
  }
  const eventId = String(input.eventId || '').trim();
  const phase = String(input.phase || '').trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(eventId) ||
    (phase !== 'progress' && phase !== 'final')
  ) {
    throw invalidEvent();
  }
  const cursor = input.cursor;
  if (
    (phase === 'progress' && cursor !== null && cursor !== undefined) ||
    (phase === 'final' &&
      (!Number.isSafeInteger(Number(cursor)) || Number(cursor) < 1))
  ) {
    throw invalidEvent();
  }

  const source = input.gift;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw invalidEvent();
  }
  const giftId = boundedText(source.giftId, 128);
  const giftName = boundedText(source.giftName, 100);
  const userName = boundedText(source.userName, 100) || '观众';
  const num = Number(source.num);
  const unitPrice = Number(source.unitPrice);
  const totalPrice = Number(source.totalPrice);
  const createdAtMs = Date.parse(String(source.createdAt || ''));
  if (
    (!giftId && !giftName) ||
    !Number.isSafeInteger(num) ||
    num < 1 ||
    !isValidMoney(unitPrice) ||
    !isValidMoney(totalPrice) ||
    totalPrice <= 0 ||
    !Number.isFinite(createdAtMs)
  ) {
    throw invalidEvent();
  }

  return Object.freeze({
    eventId,
    phase,
    cursor: phase === 'final' ? Number(cursor) : null,
    gift: Object.freeze({
      giftId,
      giftName,
      userName,
      num,
      unitPrice: normalizeMoney(unitPrice),
      totalPrice: normalizeMoney(totalPrice),
      coinType: boundedText(source.coinType, 32),
      isBlindBox: source.isBlindBox === true,
      blindBoxName: boundedText(source.blindBoxName, 100),
      blindBoxPrice: normalizeNullableMoney(source.blindBoxPrice),
      blindProfit: normalizeNullableMoney(source.blindProfit, true),
      createdAt: new Date(createdAtMs).toISOString(),
    }),
  });
}

function normalizeProcessedGiftPage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidPage();
  }
  const events = Array.isArray(input.events) ? input.events : null;
  const nextCursor = Number(input.nextCursor);
  if (
    !events ||
    events.length > 200 ||
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
  return Object.freeze({
    ok: input.ok !== false,
    events: Object.freeze(normalized),
    nextCursor,
    hasMore: input.hasMore,
  });
}

function boundedText(value, maxLength) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (text.length > maxLength) throw invalidEvent();
  return text;
}

function isValidMoney(value, signed = false) {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(Math.round(value * 100)) &&
    (signed || value >= 0)
  );
}

function normalizeMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeNullableMoney(value, signed = false) {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  if (!isValidMoney(amount, signed)) throw invalidEvent();
  return normalizeMoney(amount);
}

function invalidEvent() {
  return new Error('INVALID_PROCESSED_GIFT_EVENT');
}

function invalidPage() {
  return new Error('INVALID_PROCESSED_GIFT_PAGE');
}

module.exports = {
  normalizeProcessedGiftEvent,
  normalizeProcessedGiftPage,
};
