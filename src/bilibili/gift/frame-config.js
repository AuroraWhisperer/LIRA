'use strict';

// 各特效独立持有开关与门槛；数组顺序就是并列时的优先级（后出现者优先）。
const FRAME_EFFECTS = Object.freeze([
  Object.freeze({ themeId: 'woodland-bloom', enabledKey: 'giftFrameEnabled', thresholdKey: 'giftFrameThresholdRmb' }),
]);
const FRAME_THEME_IDS = Object.freeze(FRAME_EFFECTS.map((effect) => effect.themeId));
const DEFAULT_FRAME_SETTINGS = Object.freeze({
  giftFrameEnabled: 'false',
  giftFrameThresholdRmb: '20',
});

let previewSequence = 0;

function normalizeRmbCents(value) {
  const parsed = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const cents = Math.round(parsed * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function normalizeThresholdRmb(value) {
  const cents = normalizeRmbCents(value);
  if (cents === null) return null;
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

// 每个特效返回一条：门槛非法或缺失时回落到该特效自己的默认值。
function normalizeFrameSettings(settings = {}) {
  return FRAME_EFFECTS.map((effect) => {
    const fallback = DEFAULT_FRAME_SETTINGS[effect.thresholdKey];
    const thresholdRmb = normalizeThresholdRmb(settings[effect.thresholdKey] ?? fallback);
    return {
      themeId: effect.themeId,
      enabled: String(settings[effect.enabledKey] ?? DEFAULT_FRAME_SETTINGS[effect.enabledKey]) === 'true',
      thresholdRmb: thresholdRmb === null ? fallback : thresholdRmb,
    };
  });
}

// 同一笔礼物同时够多个门槛时只播门槛最高的那个；同门槛取 FRAME_EFFECTS 中靠后的特效。
function selectFrameTheme(totalPriceCents, settings = {}) {
  let picked = null;
  for (let index = 0; index < FRAME_EFFECTS.length; index += 1) {
    const effect = normalizeFrameSettings(settings)[index];
    if (!effect.enabled) continue;
    const thresholdCents = normalizeRmbCents(effect.thresholdRmb);
    if (thresholdCents === null || totalPriceCents < thresholdCents) continue;
    if (!picked || thresholdCents >= picked.thresholdCents) {
      picked = { themeId: effect.themeId, thresholdCents };
    }
  }
  return picked?.themeId ?? null;
}

function normalizeFrameSettingValue(key, value) {
  if (key === 'giftFrameEnabled') {
    return String(value) === 'true' || String(value) === 'false' ? String(value) : null;
  }
  if (key === 'giftFrameThresholdRmb') return normalizeThresholdRmb(value);
  return null;
}

function buildGiftFrameEvent(item, settings = {}) {
  if (item?.detection_status && item.detection_status !== 'final') return null;

  const giftEventId = Number(item?.id ?? item?.giftEventId);
  const totalPriceCents = normalizeRmbCents(item?.total_price ?? item?.totalPrice);
  if (!Number.isSafeInteger(giftEventId) || giftEventId <= 0 || totalPriceCents === null || totalPriceCents <= 0) {
    return null;
  }
  const themeId = selectFrameTheme(totalPriceCents, settings);
  if (!themeId) return null;

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
    themeId,
  };
}

function buildGiftFramePreviewEvent(input = {}) {
  const totalPriceCents = normalizeRmbCents(input.totalPriceRmb ?? input.amountRmb ?? input.totalPrice ?? 0.01);
  if (totalPriceCents === null || totalPriceCents <= 0) {
    throw new Error('预览金额必须是大于 0 的人民币金额。');
  }
  const num = normalizePreviewInteger(input.num ?? input.quantity);

  const themeId = String(input.themeId || 'woodland-bloom');
  if (!FRAME_THEME_IDS.includes(themeId)) throw new Error('礼物边框主题无效。');

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
    preview: true,
    previewSessionId,
  };
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePreviewInteger(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 1;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('预览数量必须是正整数。');
  return parsed;
}

function normalizeDisplayText(value, fallback) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

module.exports = {
  DEFAULT_FRAME_SETTINGS,
  FRAME_EFFECTS,
  FRAME_THEME_IDS,
  normalizeRmbCents,
  normalizeThresholdRmb,
  normalizeFrameSettings,
  selectFrameTheme,
  normalizeFrameSettingValue,
  buildGiftFrameEvent,
  buildGiftFramePreviewEvent,
};
