'use strict';

// 大航海感谢：final 礼物行中的舰长/提督/总督购买转换为 gift-effects 的专属动画事件。

const { canonicalizeGuardGiftId } = require('./guard-gift-aliases');

// 与 B 站 guard_level 一致：1 总督、2 提督、3 舰长。
const GUARD_LEVEL_BY_NAME = new Map([
  ['总督', 1],
  ['提督', 2],
  ['舰长', 3],
]);
const MAX_PREVIEW_MONTHS = 999;

let previewSequence = 0;

function resolveGuardPurchaseLevel(item) {
  const match = /^guard-([1-3])$/u.exec(canonicalizeGuardGiftId(item?.gift_id ?? item?.giftId));
  if (match) return Number(match[1]);
  // 未登记的新大航海礼物 ID 仍以服务器给出的精确等级名称识别。
  return GUARD_LEVEL_BY_NAME.get(String(item?.gift_name ?? item?.giftName ?? '').replace(/\s+/gu, '')) || 0;
}

function normalizeGuardThanksSettingValue(value) {
  return String(value) === 'true' || String(value) === 'false' ? String(value) : null;
}

function buildGuardThanksEvent(item, settings = {}) {
  if (String(settings.guardThanksEnabled) !== 'true') return null;
  if (item?.detection_status && item.detection_status !== 'final') return null;
  const giftEventId = Number(item?.id ?? item?.giftEventId);
  const guardLevel = resolveGuardPurchaseLevel(item);
  if (!Number.isSafeInteger(giftEventId) || giftEventId <= 0 || !guardLevel) return null;
  const avatarUrl = String(item?.avatar_url ?? item?.avatarUrl ?? '').trim();
  return {
    type: 'gift:guard',
    eventId: `gift-guard:${giftEventId}`,
    giftEventId,
    guardLevel,
    userName: normalizeDisplayText(item?.user_name ?? item?.userName, '观众'),
    num: normalizePositiveInteger(item?.num),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function buildGuardThanksPreviewEvent(input = {}) {
  const guardLevel = Number(input.guardLevel);
  if (![1, 2, 3].includes(guardLevel)) throw new Error('请选择舰长、提督或总督。');
  const num = input.num === undefined || input.num === null || String(input.num).trim() === '' ? 1 : Number(input.num);
  if (!Number.isSafeInteger(num) || num < 1 || num > MAX_PREVIEW_MONTHS) {
    throw new Error(`开通月数必须是 1 至 ${MAX_PREVIEW_MONTHS} 的整数。`);
  }
  previewSequence = (previewSequence + 1) % 1000000;
  const previewSessionId = `preview-${Date.now()}-${previewSequence}`;
  return {
    type: 'gift:guard',
    eventId: `gift-guard:${previewSessionId}`,
    giftEventId: 0,
    guardLevel,
    userName: normalizeDisplayText(input.userName, '观众A'),
    num,
    preview: true,
    previewSessionId,
  };
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeDisplayText(value, fallback) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

module.exports = {
  MAX_PREVIEW_MONTHS,
  resolveGuardPurchaseLevel,
  normalizeGuardThanksSettingValue,
  buildGuardThanksEvent,
  buildGuardThanksPreviewEvent,
};
