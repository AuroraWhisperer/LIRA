'use strict';

const { normalizeGiftDisplayProfile } = require('./processed-gift-contract');
const eventIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const invalid = () => new Error('INVALID_GIFT_CARD_PROFILES');

function normalizeGiftCardProfilePage(value) {
  if (!value || value.ok !== true || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
    typeof value.syncEpoch !== 'string' || !value.syncEpoch || value.syncEpoch.length > 128 ||
    !Array.isArray(value.items) || value.items.length > 200 ||
    (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !eventIdPattern.test(value.nextCursor)))) throw invalid();
  const items = value.items.map((item) => {
    if (!item || typeof item.eventId !== 'string' || !eventIdPattern.test(item.eventId) ||
      (item.senderId !== null && (typeof item.senderId !== 'string' || !/^[1-9]\d{0,24}$/.test(item.senderId))) ||
      typeof item.userName !== 'string' || Array.from(item.userName).length > 100 ||
      typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw invalid();
    const display = normalizeGiftDisplayProfile({ version: 1, avatarUrl: item.avatarUrl, guardLevel: item.guardLevel }, invalid);
    return { eventId: item.eventId, senderId: item.senderId, userName: item.userName,
      createdAt: new Date(item.createdAt).toISOString(), avatarUrl: display.avatarUrl, guardLevel: display.guardLevel };
  });
  if (value.nextCursor && (!items.length || items.at(-1).eventId !== value.nextCursor)) throw invalid();
  return { day: value.day, syncEpoch: value.syncEpoch, items, nextCursor: value.nextCursor };
}

module.exports = { normalizeGiftCardProfilePage };
