'use strict';

const GIFT_DISPLAY_SETTING = 'giftDisplayConfig';
const DEFAULT_GIFT_DISPLAY = Object.freeze({
  palette: 'bilibili-four', thresholds: [10000, 50000, 100000],
  visibleRows: 3, intervalSeconds: 4, paused: false, lowPower: false,
});

function validateGiftDisplaySettings(value) {
  if (!value || value.palette !== 'bilibili-four' || !Array.isArray(value.thresholds) ||
    value.thresholds.length !== 3 || value.thresholds.some((v, i, a) =>
      !Number.isSafeInteger(v) || v <= 0 || (i > 0 && v <= a[i - 1]))) {
    throw new Error('三个分界金额必须大于 0、严格递增，且最多保留两位小数。');
  }
  if (!Number.isInteger(value.visibleRows) || value.visibleRows < 1 || value.visibleRows > 10 ||
    !Number.isInteger(value.intervalSeconds) || value.intervalSeconds < 2 || value.intervalSeconds > 60 ||
    typeof value.paused !== 'boolean' || typeof value.lowPower !== 'boolean') {
    throw new Error('显示行数须为 1–10，间隔须为 2–60 秒。');
  }
  return { palette: 'bilibili-four', thresholds: [...value.thresholds], visibleRows: value.visibleRows,
    intervalSeconds: value.intervalSeconds, paused: value.paused, lowPower: value.lowPower };
}

function readGiftDisplaySettings(settings) {
  try { return validateGiftDisplaySettings(JSON.parse(settings?.[GIFT_DISPLAY_SETTING])); }
  catch { return structuredClone(DEFAULT_GIFT_DISPLAY); }
}

module.exports = { GIFT_DISPLAY_SETTING, DEFAULT_GIFT_DISPLAY, validateGiftDisplaySettings, readGiftDisplaySettings };
