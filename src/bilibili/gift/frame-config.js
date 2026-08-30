'use strict';

const FRAME_THEME_IDS = Object.freeze(['woodland-bloom']);
const FRAME_MOTION_MODES = Object.freeze(['auto', 'full', 'reduced']);
const DEFAULT_FRAME_SETTINGS = Object.freeze({
  giftFrameEnabled: 'false',
  giftFrameThresholdRmb: '20',
  giftFrameTheme: 'woodland-bloom',
  giftFrameMotionMode: 'auto',
});

let previewSequence = 0;

function normalizeRmbCents(value) {
  const parsed =
    typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const cents = Math.round(parsed * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function normalizeThresholdRmb(value) {
  const cents = normalizeRmbCents(value);
  if (cents === null) return null;
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function normalizeFrameSettings(settings = {}) {
  const thresholdRmb = normalizeThresholdRmb(
    settings.giftFrameThresholdRmb ??
      DEFAULT_FRAME_SETTINGS.giftFrameThresholdRmb,
  );
  return {
    enabled:
      String(
        settings.giftFrameEnabled ?? DEFAULT_FRAME_SETTINGS.giftFrameEnabled,
      ) === 'true',
    thresholdRmb:
      thresholdRmb === null
        ? DEFAULT_FRAME_SETTINGS.giftFrameThresholdRmb
        : thresholdRmb,
    themeId: FRAME_THEME_IDS.includes(String(settings.giftFrameTheme || ''))
      ? String(settings.giftFrameTheme)
      : DEFAULT_FRAME_SETTINGS.giftFrameTheme,
    motionMode: FRAME_MOTION_MODES.includes(
      String(settings.giftFrameMotionMode || ''),
    )
      ? String(settings.giftFrameMotionMode)
      : DEFAULT_FRAME_SETTINGS.giftFrameMotionMode,
  };
}

function normalizeFrameSettingValue(key, value) {
  if (key === 'giftFrameEnabled') {
    const normalized =
      String(value) === 'true' || String(value) === 'false'
        ? String(value)
        : null;
    return normalized;
  }
  if (key === 'giftFrameThresholdRmb') return normalizeThresholdRmb(value);
  if (key === 'giftFrameTheme') {
    return FRAME_THEME_IDS.includes(String(value)) ? String(value) : null;
  }
  if (key === 'giftFrameMotionMode') {
    return FRAME_MOTION_MODES.includes(String(value)) ? String(value) : null;
  }
  return String(value);
}

function buildGiftFrameEvent(item, settings = {}) {
  const normalizedSettings = normalizeFrameSettings(settings);
  if (!normalizedSettings.enabled) return null;
  if (item?.detection_status && item.detection_status !== 'final') return null;

  const giftEventId = Number(item?.id ?? item?.giftEventId);
  const totalPriceCents = normalizeRmbCents(
    item?.total_price ?? item?.totalPrice,
  );
  const thresholdCents = normalizeRmbCents(normalizedSettings.thresholdRmb);
  if (
    !Number.isSafeInteger(giftEventId) ||
    giftEventId <= 0 ||
    totalPriceCents === null ||
    totalPriceCents <= 0 ||
    thresholdCents === null ||
    totalPriceCents < thresholdCents
  ) {
    return null;
  }

  const giftId = Number(item?.gift_id ?? item?.giftId);
  return {
    type: 'gift:frame',
    eventId: `gift-frame:${giftEventId}`,
    giftEventId,
    giftId: Number.isSafeInteger(giftId) && giftId > 0 ? giftId : 0,
    giftName: normalizeDisplayText(item?.gift_name ?? item?.giftName, '礼物'),
    num: normalizePositiveInteger(item?.num),
    totalPriceCents,
    userName: normalizeDisplayText(item?.user_name ?? item?.userName, '观众'),
    themeId: normalizedSettings.themeId,
  };
}

function buildGiftFramePreviewEvent(input = {}) {
  const totalPriceCents = normalizeRmbCents(
    input.totalPriceRmb ?? input.amountRmb ?? input.totalPrice,
  );
  if (totalPriceCents === null || totalPriceCents <= 0) {
    throw new Error('预览金额必须是大于 0 的人民币金额。');
  }
  const num = normalizePreviewInteger(input.num ?? input.quantity);

  const themeId = String(
    input.themeId || DEFAULT_FRAME_SETTINGS.giftFrameTheme,
  );
  const motionMode = String(
    input.motionMode || DEFAULT_FRAME_SETTINGS.giftFrameMotionMode,
  );
  if (!FRAME_THEME_IDS.includes(themeId)) throw new Error('礼物边框主题无效。');
  if (!FRAME_MOTION_MODES.includes(motionMode))
    throw new Error('礼物边框动效模式无效。');

  previewSequence = (previewSequence + 1) % 1000000;
  const previewSessionId = `preview-${Date.now()}-${previewSequence}`;
  return {
    type: 'gift:frame',
    eventId: `gift-frame:${previewSessionId}`,
    giftEventId: 0,
    giftId: 0,
    giftName: normalizeDisplayText(input.giftName, '测试礼物'),
    num,
    totalPriceCents,
    userName: normalizeDisplayText(input.userName ?? input.viewerName, '观众A'),
    themeId,
    motionMode,
    preview: true,
    previewSessionId,
  };
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePreviewInteger(value) {
  if (value === undefined || value === null || String(value).trim() === '')
    return 1;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error('预览数量必须是正整数。');
  return parsed;
}

function normalizeDisplayText(value, fallback) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

module.exports = {
  DEFAULT_FRAME_SETTINGS,
  FRAME_THEME_IDS,
  FRAME_MOTION_MODES,
  normalizeRmbCents,
  normalizeThresholdRmb,
  normalizeFrameSettings,
  normalizeFrameSettingValue,
  buildGiftFrameEvent,
  buildGiftFramePreviewEvent,
};
