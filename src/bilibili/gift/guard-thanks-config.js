'use strict';

// 大航海感谢：final 礼物行之后识别舰长/提督/总督，生成礼物特效地址播放的感谢事件。

const { canonicalizeGuardGiftId } = require('./guard-gift-aliases');

const GUARD_THANKS_TIERS = Object.freeze(['captain', 'admiral', 'governor']);
const GUARD_THANKS_TEXT_MODES = Object.freeze(['bilingual', 'zh', 'en']);
// classic：金属徽章硬朗风格（保留旧行为）；aurora：辉光柔和风格。
const GUARD_THANKS_STYLES = Object.freeze(['aurora', 'classic']);
const DEFAULT_GUARD_THANKS_SETTINGS = Object.freeze({
  guardThanksEnabled: 'false',
  guardThanksTextMode: 'bilingual',
  guardThanksStyle: 'aurora',
});
const TIER_BY_GUARD_GIFT_ID = Object.freeze({ 'guard-1': 'governor', 'guard-2': 'admiral', 'guard-3': 'captain' });
const TIER_BY_GIFT_NAME = Object.freeze({ 总督: 'governor', 提督: 'admiral', 舰长: 'captain' });
const MAX_PREVIEW_MONTHS = 999;

let previewSequence = 0;

function resolveGuardTier(item) {
  const canonicalId = canonicalizeGuardGiftId(item?.gift_id ?? item?.giftId);
  if (TIER_BY_GUARD_GIFT_ID[canonicalId]) return TIER_BY_GUARD_GIFT_ID[canonicalId];
  const name = String(item?.gift_name ?? item?.giftName ?? '').replace(/\s+/gu, '');
  return TIER_BY_GIFT_NAME[name] || null;
}

function normalizeTextMode(value) {
  return GUARD_THANKS_TEXT_MODES.includes(String(value)) ? String(value) : null;
}

function normalizeStyle(value) {
  return GUARD_THANKS_STYLES.includes(String(value)) ? String(value) : null;
}

function normalizeGuardThanksSettingValue(key, value) {
  if (key === 'guardThanksEnabled') {
    if (value === true || value === 'true') return 'true';
    if (value === false || value === 'false') return 'false';
    return null;
  }
  if (key === 'guardThanksTextMode') return normalizeTextMode(value);
  if (key === 'guardThanksStyle') return normalizeStyle(value);
  return String(value);
}

function buildGuardThanksEvent(item, settings = {}) {
  if (String(settings.guardThanksEnabled ?? DEFAULT_GUARD_THANKS_SETTINGS.guardThanksEnabled) !== 'true') return null;
  if (item?.detection_status && item.detection_status !== 'final') return null;
  const giftEventId = Number(item?.id ?? item?.giftEventId);
  const tier = resolveGuardTier(item);
  if (!Number.isSafeInteger(giftEventId) || giftEventId <= 0 || !tier) return null;
  return {
    type: 'gift:guard-thanks',
    eventId: `guard-thanks:${giftEventId}`,
    giftEventId,
    tier,
    userName: normalizeDisplayText(item?.user_name ?? item?.userName, '观众'),
    months: normalizePositiveInteger(item?.num),
    avatarUrl: normalizeAvatarUrl(item?.avatar_url ?? item?.avatarUrl),
    textMode: normalizeTextMode(settings.guardThanksTextMode) || DEFAULT_GUARD_THANKS_SETTINGS.guardThanksTextMode,
    style: normalizeStyle(settings.guardThanksStyle) || DEFAULT_GUARD_THANKS_SETTINGS.guardThanksStyle,
  };
}

function buildGuardThanksPreviewEvent(input = {}) {
  const tier = String(input.tier || '');
  if (!GUARD_THANKS_TIERS.includes(tier)) throw new Error('请选择舰长、提督或总督。');
  const textMode =
    input.textMode === undefined ? DEFAULT_GUARD_THANKS_SETTINGS.guardThanksTextMode : normalizeTextMode(input.textMode);
  if (!textMode) throw new Error('大航海感谢文字模式无效。');
  const style =
    input.style === undefined ? DEFAULT_GUARD_THANKS_SETTINGS.guardThanksStyle : normalizeStyle(input.style);
  if (!style) throw new Error('大航海感谢动画风格无效。');
  const months = input.months === undefined || String(input.months).trim() === '' ? 1 : Number(input.months);
  if (!Number.isSafeInteger(months) || months <= 0 || months > MAX_PREVIEW_MONTHS) {
    throw new Error(`预览月数必须是 1–${MAX_PREVIEW_MONTHS} 的整数。`);
  }
  previewSequence = (previewSequence + 1) % 1000000;
  return {
    type: 'gift:guard-thanks',
    eventId: `guard-thanks:preview-${Date.now()}-${previewSequence}`,
    giftEventId: 0,
    tier,
    userName: normalizeDisplayText(input.userName, '观众A').slice(0, 100),
    months,
    avatarUrl: '',
    textMode,
    style,
    preview: true,
  };
}

function normalizeAvatarUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return '';
  try {
    const url = new URL(value);
    const trusted = url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com');
    return url.protocol === 'https:' && trusted && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
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
  DEFAULT_GUARD_THANKS_SETTINGS,
  GUARD_THANKS_TIERS,
  GUARD_THANKS_TEXT_MODES,
  resolveGuardTier,
  normalizeGuardThanksSettingValue,
  buildGuardThanksEvent,
  buildGuardThanksPreviewEvent,
};
