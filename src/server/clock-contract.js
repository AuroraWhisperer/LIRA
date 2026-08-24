'use strict';

const CLOCK_STYLE_VALUES = new Set(['peach', 'starlight', 'soda']);
const CLOCK_BOOLEAN_SETTING_KEYS = new Set(['clockShowDate', 'clockShowSeconds']);
const CLOCK_SETTING_KEYS = new Set([
  'clockStyle',
  ...CLOCK_BOOLEAN_SETTING_KEYS,
  'clockHourFormat',
  'clockLabel'
]);
const DEFAULT_LABELS = Object.freeze({
  peach: '今天也要闪闪发光',
  starlight: '今晚与星星一起值班',
  soda: '今天也要元气满满'
});
const MAX_LABEL_LENGTH = 16;

function cleanClockLabel(value) {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(normalized).slice(0, MAX_LABEL_LENGTH).join('');
}

function normalizeBooleanSetting(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return 'true';
  if (normalized === 'false' || normalized === '0') return 'false';
  return null;
}

function normalizeClockSettingValue(key, rawValue) {
  if (key === 'clockStyle') {
    const value = String(rawValue ?? '').trim();
    return CLOCK_STYLE_VALUES.has(value) ? value : null;
  }
  if (CLOCK_BOOLEAN_SETTING_KEYS.has(key)) return normalizeBooleanSetting(rawValue);
  if (key === 'clockHourFormat') {
    const value = String(rawValue ?? '').trim();
    return value === '12' || value === '24' ? value : null;
  }
  if (key === 'clockLabel') return cleanClockLabel(rawValue);
  return null;
}

function getClockConfig(settings = {}) {
  const style = normalizeClockSettingValue('clockStyle', settings.clockStyle) || 'peach';
  return {
    style,
    showDate: normalizeClockSettingValue('clockShowDate', settings.clockShowDate) !== 'false',
    showSeconds: normalizeClockSettingValue('clockShowSeconds', settings.clockShowSeconds) !== 'false',
    hourFormat: normalizeClockSettingValue('clockHourFormat', settings.clockHourFormat) || '24',
    label: cleanClockLabel(settings.clockLabel) || DEFAULT_LABELS[style]
  };
}

module.exports = {
  CLOCK_SETTING_KEYS,
  CLOCK_STYLE_VALUES,
  DEFAULT_LABELS,
  cleanClockLabel,
  getClockConfig,
  normalizeClockSettingValue
};
