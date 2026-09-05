'use strict';

const { normalizeRoomInput } = require('../shared/utils');
const { parseCustomReplyRules } = require('../bilibili/custom-reply-service');
const { normalizeFrameSettingValue } = require('../bilibili/gift/frame-config');
const {
  normalizeGiftBlindBoxConfig,
  normalizeGiftBlindBoxCustomConfigV2,
} = require('../bilibili/gift/blind-box-config');
const { normalizeOpeningTrackMotion } = require('./opening-contract');
const { CLOCK_SETTING_KEYS, normalizeClockSettingValue } = require('./clock-contract');

const CLOUD_SETTING_KEYS = Object.freeze([
  'roomId', 'enableBilibili', 'paused', 'queueLimit', 'userCooldownSeconds',
  'onlyFromLibrary', 'allowDuplicate',
]);
const CLOUD_BOOLEAN_KEYS = new Set([
  'enableBilibili', 'paused', 'onlyFromLibrary', 'allowDuplicate',
]);
const CLOUD_SYNC_KEYS = new Set([
  ...CLOUD_SETTING_KEYS,
  'giftBlindBoxConfig',
  'giftBlindBoxCustomConfigV2',
]);
const JSON_SETTING_KEYS = new Set(['checkinBlessings', 'fortunePool']);
const FRAME_SETTING_KEYS = new Set([
  'giftFrameEnabled', 'giftFrameThresholdRmb', 'giftFrameTheme', 'giftFrameMotionMode',
]);
const DANMAKU_OVERLAY_STYLES = new Set([
  'bubble', 'signal', 'minimal', 'ranked', 'transparent', 'outline',
]);

function normalizeSettingValue(key, rawValue) {
  if (CLOUD_BOOLEAN_KEYS.has(key)) {
    if (rawValue === true || rawValue === 1 || rawValue === 'true' || rawValue === '1') return 'true';
    if (rawValue === false || rawValue === 0 || rawValue === 'false' || rawValue === '0') return 'false';
    return null;
  }
  if (key === 'queueLimit' || key === 'userCooldownSeconds') {
    if (typeof rawValue !== 'number' && typeof rawValue !== 'string') return null;
    if (typeof rawValue === 'string' && !rawValue.trim()) return null;
    const number = Number(rawValue);
    const min = key === 'queueLimit' ? 1 : 0;
    const max = key === 'queueLimit' ? 300 : 3600;
    return Number.isInteger(number) && number >= min && number <= max ? String(number) : null;
  }
  if (FRAME_SETTING_KEYS.has(key)) return normalizeFrameSettingValue(key, rawValue);
  if (CLOCK_SETTING_KEYS.has(key)) return normalizeClockSettingValue(key, rawValue);
  if (key === 'danmakuOverlayStyle') {
    const value = String(rawValue || '').trim();
    return DANMAKU_OVERLAY_STYLES.has(value) ? value : null;
  }
  if (key === 'danmakuFullscreenDurationSeconds') {
    const value = normalizeFullscreenDurationSeconds(rawValue);
    return value === null ? null : String(value);
  }
  if (key === 'openingTrackMotion') return normalizeOpeningTrackMotion(rawValue);
  if (key === 'roomId') {
    const value = normalizeRoomInput(rawValue);
    return String(rawValue || '').trim() && !value ? null : value;
  }
  if (key === 'customReplyRules') return JSON.stringify(parseCustomReplyRules(rawValue));
  if (key === 'giftBlindBoxConfig') {
    try {
      const input = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      return JSON.stringify(normalizeGiftBlindBoxConfig(input));
    } catch (error) {
      void error;
      return null;
    }
  }
  if (key === 'giftBlindBoxCustomConfigV2') {
    if (rawValue === null || rawValue === 'null') return 'null';
    try {
      const input = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      return JSON.stringify(normalizeGiftBlindBoxCustomConfigV2(input));
    } catch (error) {
      void error;
      return null;
    }
  }
  if (JSON_SETTING_KEYS.has(key)) {
    if (rawValue === null || rawValue === undefined) return String(rawValue);
    return typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
  }
  return String(rawValue);
}

function normalizeFullscreenDurationSeconds(rawValue) {
  let value;
  if (typeof rawValue === 'number') value = rawValue;
  else if (typeof rawValue === 'string' && /^\d+$/.test(rawValue.trim())) value = Number(rawValue.trim());
  else return null;
  return Number.isSafeInteger(value) && value >= 2 && value <= 30 ? value : null;
}

function normalizeSettingsPatch(input, defaults) {
  const values = {};
  for (const [key, rawValue] of Object.entries(input || {})) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
    const value = normalizeSettingValue(key, rawValue);
    if (value === null) return { error: `设置 ${key} 的值无效。` };
    values[key] = value;
  }
  return { values };
}

function normalizeCloudSettingsSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('云端同步设置格式无效。');
  const values = {};
  for (const key of CLOUD_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`云端同步设置缺少 ${key}。`);
    const value = normalizeSettingValue(key, input[key]);
    if (value === null) throw new Error(`云端同步设置 ${key} 的值无效。`);
    values[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'giftBlindBoxConfig')) {
    const value = normalizeSettingValue('giftBlindBoxConfig', input.giftBlindBoxConfig);
    if (value === null) throw new Error('INVALID_GIFT_BLIND_BOX_CONFIG');
    values.giftBlindBoxConfig = value;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'giftBlindBoxCustomConfigV2')) {
    const value = normalizeSettingValue(
      'giftBlindBoxCustomConfigV2',
      input.giftBlindBoxCustomConfigV2,
    );
    if (value === null) throw new Error('INVALID_GIFT_BLIND_BOX_CONFIG');
    values.giftBlindBoxCustomConfigV2 = value;
  }
  return values;
}

function serializeCloudSettings(settings) {
  const values = {
    roomId: normalizeRoomInput(settings.roomId),
    enableBilibili: settings.enableBilibili === 'true',
    paused: settings.paused === 'true',
    queueLimit: Number(settings.queueLimit),
    userCooldownSeconds: Number(settings.userCooldownSeconds),
    onlyFromLibrary: settings.onlyFromLibrary === 'true',
    allowDuplicate: settings.allowDuplicate === 'true',
    giftBlindBoxConfig: normalizeGiftBlindBoxConfig(JSON.parse(settings.giftBlindBoxConfig)),
  };
  const customConfigV2 = JSON.parse(settings.giftBlindBoxCustomConfigV2 || 'null');
  if (Array.isArray(customConfigV2)) {
    values.giftBlindBoxCustomConfigV2 =
      normalizeGiftBlindBoxCustomConfigV2(customConfigV2);
  }
  return values;
}

function hasCloudSettingChanges(keys) {
  return keys.some((key) => CLOUD_SYNC_KEYS.has(key));
}

module.exports = {
  hasCloudSettingChanges,
  normalizeCloudSettingsSnapshot,
  normalizeSettingsPatch,
  serializeCloudSettings,
};
