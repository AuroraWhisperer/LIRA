'use strict';

const GIFT_DISPLAY_SETTING = 'giftDisplayConfig';
const DEFAULT_GIFT_DISPLAY = Object.freeze({
  palette: 'bilibili-four',
  thresholds: [3000, 10000, 100000],
  visibleRows: 3,
  scrollSpeed: 25,
  minGiftAmountCents: 0,
});

function validateGiftDisplaySettings(value) {
  if (
    !value ||
    value.palette !== 'bilibili-four' ||
    !Array.isArray(value.thresholds) ||
    value.thresholds.length !== 3 ||
    value.thresholds.some((v, i, a) => !Number.isSafeInteger(v) || v <= 0 || (i > 0 && v <= a[i - 1]))
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
  return {
    palette: 'bilibili-four',
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

module.exports = { GIFT_DISPLAY_SETTING, DEFAULT_GIFT_DISPLAY, validateGiftDisplaySettings, readGiftDisplaySettings };
