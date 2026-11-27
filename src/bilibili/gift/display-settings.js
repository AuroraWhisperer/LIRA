'use strict';

const { validGiftBannerStyles, validGiftThresholds, DEFAULT_GIFT_BANNER_APPEARANCE } = require('../../../public/js/shared/gift-banner-styles.js');

const GIFT_DISPLAY_SETTING = 'giftDisplayConfig';
const DEFAULT_GIFT_DISPLAY = Object.freeze({
  palette: 'bilibili-four',
  ...DEFAULT_GIFT_BANNER_APPEARANCE,
  thresholds: [3000, 10000, 100000],
  visibleRows: 3,
  scrollSpeed: 12,
  minGiftAmountCents: 0,
});

function validateGiftDisplaySettings(value) {
  if (
    !value ||
    value.palette !== 'bilibili-four' ||
    !validGiftThresholds(value.thresholds)
  ) {
    throw new Error('三个分界金额必须大于 0、严格递增，且最多保留两位小数。');
  }
  // Legacy intervals are all at least two seconds; retain their slowest supported speed.
  const legacy =
    value.scrollSpeed === undefined &&
    Number.isInteger(value.intervalSeconds) &&
    value.intervalSeconds >= 2 &&
    value.intervalSeconds <= 60 &&
    typeof value.paused === 'boolean' &&
    typeof value.lowPower === 'boolean';
  const scrollSpeed = legacy ? 1 : value.scrollSpeed;
  if (
    !Number.isInteger(value.visibleRows) ||
    value.visibleRows < 1 ||
    value.visibleRows > 10 ||
    !Number.isInteger(scrollSpeed) ||
    scrollSpeed < 1 ||
    scrollSpeed > 50
  ) {
    throw new Error('显示行数须为 1–10 的整数，滚动速率须为 1–50 的整数。');
  }
  const minGiftAmountCents = value.minGiftAmountCents === undefined ? 0 : value.minGiftAmountCents;
  if (!Number.isSafeInteger(minGiftAmountCents) || minGiftAmountCents < 0 || minGiftAmountCents % 10 !== 0) {
    throw new Error('最小礼物金额须大于或等于 0，且最多保留一位小数。');
  }
  const { tailStyle = DEFAULT_GIFT_BANNER_APPEARANCE.tailStyle, textureStyle = DEFAULT_GIFT_BANNER_APPEARANCE.textureStyle } = value;
  if (!validGiftBannerStyles(tailStyle, textureStyle)) {
    throw new Error('请选择有效的礼物条带外形和内部样式。');
  }
  const sheen = value.sheen === undefined ? DEFAULT_GIFT_BANNER_APPEARANCE.sheen : value.sheen;
  if (typeof sheen !== 'boolean') {
    throw new Error('白色扫光须为开启或关闭。');
  }
  return {
    palette: 'bilibili-four',
    tailStyle,
    textureStyle,
    sheen,
    thresholds: [...value.thresholds],
    visibleRows: value.visibleRows,
    scrollSpeed,
    minGiftAmountCents,
  };
}

function readGiftDisplaySettings(settings) {
  try {
    return validateGiftDisplaySettings(JSON.parse(settings?.[GIFT_DISPLAY_SETTING]));
  } catch {
    return structuredClone(DEFAULT_GIFT_DISPLAY);
  }
}

function patchGiftDisplaySettings(settings, patch) {
  const allowed = ['threshold1', 'threshold2', 'threshold3', 'visibleRows', 'scrollSpeed',
    'minGiftAmountCents', 'tailStyle', 'textureStyle', 'sheen'];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || !Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) {
    throw new Error('礼物显示设置补丁字段无效。');
  }
  const next = readGiftDisplaySettings(settings);
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('threshold')) next.thresholds[Number(key.slice(-1)) - 1] = value;
    else next[key] = value;
  }
  return validateGiftDisplaySettings(next);
}

module.exports = { GIFT_DISPLAY_SETTING, DEFAULT_GIFT_DISPLAY, validateGiftDisplaySettings, readGiftDisplaySettings, patchGiftDisplaySettings };
