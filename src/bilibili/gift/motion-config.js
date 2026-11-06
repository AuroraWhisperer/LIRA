'use strict';

const { normalizeRmbCents, normalizeThresholdRmb } = require('./frame-config');
const { GIFT_MOTION_EFFECTS, GIFT_MOTION_DEFAULTS, readGiftMotionSettings } = require('../../../public/js/shared/gift-motion-settings.js');

function normalizeGiftMotionSetting(key, raw) {
  if (!Object.hasOwn(GIFT_MOTION_DEFAULTS, key)) return null;
  if (key.endsWith('Enabled')) return [true, false, 'true', 'false'].includes(raw) ? String(raw) : null;
  if (key.endsWith('ThresholdRmb')) return normalizeThresholdRmb(raw);
  const effect = GIFT_MOTION_EFFECTS.find(effect => key.startsWith(effect.prefix));
  const field = effect.fields[key.slice(effect.prefix.length)];
  if (field.options) return field.options.some(([value]) => value === raw) ? raw : null;
  const value = Number(raw);
  return ['string', 'number'].includes(typeof raw) && String(raw).trim() !== '' && Number.isInteger(value)
    && value >= field.min && value <= field.max ? String(value) : null;
}

function buildGiftMotionEvents(item, settings = {}, { startedAt = Date.now(), artworkPath = '' } = {}) {
  if (item?.detection_status !== 'final') return [];
  const id = Number(item.id);
  const totalPriceCents = normalizeRmbCents(item.total_price);
  if (!Number.isSafeInteger(id) || id <= 0 || !totalPriceCents) return [];
  return GIFT_MOTION_EFFECTS.filter(effect => {
    const threshold = normalizeRmbCents(settings[`${effect.prefix}ThresholdRmb`] ?? '0');
    return settings[`${effect.prefix}Enabled`] === 'true' && threshold !== null && totalPriceCents >= threshold;
  }).map(effect => ({
    type: 'gift:frame', themeId: effect.style, eventId: `gift-motion:${effect.style}:${id}`,
    giftName: String(item.gift_name || '礼物'), userName: String(item.user_name || '观众'),
    num: Number.isSafeInteger(Number(item.num)) && Number(item.num) > 0 ? Number(item.num) : 1,
    totalPriceCents, artworkPath, startedAt, motion: readGiftMotionSettings(settings, effect),
  }));
}

module.exports = { normalizeGiftMotionSetting, buildGiftMotionEvents };
