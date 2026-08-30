'use strict';

const {
  cleanText,
  normalizePositiveInteger,
  readObjectValue,
} = require('../../shared/utils');
const { readFirstObject } = require('../utils/user-meta-extractor');

function buildBilibiliGuardPurchaseId(uid, giftId, startTime) {
  const normalizedUid = cleanText(uid);
  const normalizedGiftId = cleanText(giftId);
  const normalizedStartTime = cleanText(startTime);
  if (!normalizedUid || !normalizedGiftId || !normalizedStartTime) return '';
  return `guard:${normalizedUid}:${normalizedGiftId}:${normalizedStartTime}`;
}

function isBilibiliDuplicateGuardToast(packet) {
  const cmd = cleanText(packet && packet.cmd);
  if (!cmd.startsWith('USER_TOAST_MSG_V2')) return false;
  const data =
    packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  const option = readFirstObject(data, ['option']) || {};
  const source =
    readObjectValue(option, ['source']) ?? readObjectValue(data, ['source']);
  return Number(source) === 2;
}

function normalizeBilibiliGuardQuantity(value, unitValue) {
  const quantity = normalizePositiveInteger(value) || 1;
  const unit = cleanText(unitValue);
  return unit && !unit.includes('月') ? 1 : quantity;
}

function isBilibiliGiftCommand(cmd, runtimeGiftPrefixes) {
  const text = String(cmd || '');
  if (runtimeGiftPrefixes.has(text)) return true;
  for (const prefix of runtimeGiftPrefixes) {
    if (text.startsWith(`${prefix}_`)) return true;
  }
  return (
    text.startsWith('SEND_GIFT') ||
    text.startsWith('BLIND_GIFT') ||
    text.startsWith('COMBO_SEND') ||
    text.startsWith('GUARD_BUY') ||
    text.startsWith('USER_TOAST_MSG') ||
    text.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT') ||
    text.startsWith('LIVE_OPEN_PLATFORM_GUARD')
  );
}

function isBilibiliGiftLikeCommand(cmd, runtimeGiftPrefixes) {
  const text = String(cmd || '');
  if (text.startsWith('COMBO_END')) return false;
  return (
    isBilibiliGiftCommand(text, runtimeGiftPrefixes) ||
    text.includes('GIFT') ||
    text.includes('COMBO') ||
    text.includes('GUARD')
  );
}

module.exports = {
  buildBilibiliGuardPurchaseId,
  isBilibiliDuplicateGuardToast,
  isBilibiliGiftCommand,
  isBilibiliGiftLikeCommand,
  normalizeBilibiliGuardQuantity,
};
