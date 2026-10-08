'use strict';

const { normalizeStyleParameters } = require('../shared/component-style-parameters');
const { CLOCK_APPEARANCE_KEYS, clockStyleOptions } = require('../../public/js/shared/clock-settings.js');

const CLOCK_STYLE_VALUES = new Set([
  'peach',
  'starlight',
  'soda',
  'timeline-horizontal',
  'timeline-vertical',
  'digital',
  'orbit',
  'flip',
  'moonlit-fan',
]);
const CLOCK_BOOLEAN_SETTING_KEYS = new Set(['clockShowDate', 'clockShowSeconds']);
const CLOCK_COLOR_DEFAULTS = Object.freeze({
  clockFlipFrameColor: '#e4e4e4',
  clockFlipFaceColor: '#ffffff',
  clockFlipTextColor: '#303030',
});
const CLOCK_SETTING_KEYS = new Set([
  'clockStyle',
  'clockStyleParameters',
  'clockStyleOptions',
  ...CLOCK_BOOLEAN_SETTING_KEYS,
  'clockHourFormat',
  'clockLabel',
  'clockMoonMode',
  'clockMoonIntervalSeconds',
  ...Object.keys(CLOCK_COLOR_DEFAULTS),
]);
const DEFAULT_LABELS = Object.freeze({
  peach: '今天也要闪闪发光',
  starlight: '今晚与星星一起值班',
  soda: '今天也要元气满满',
  'timeline-horizontal': '',
  'timeline-vertical': '',
  digital: '',
  orbit: '',
  flip: '',
  'moonlit-fan': '',
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
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'true' || normalized === '1') return 'true';
  if (normalized === 'false' || normalized === '0') return 'false';
  return null;
}

function normalizeClockSettingValue(key, rawValue) {
  if (key === 'clockStyleOptions') {
    try { return JSON.stringify(normalizeClockStyleOptions(JSON.parse(String(rawValue)))); }
    catch { return null; }
  }
  if (key === 'clockStyleParameters') {
    try { return JSON.stringify(normalizeStyleParameters('clock', JSON.parse(String(rawValue)))); }
    catch { return null; }
  }
  if (Object.hasOwn(CLOCK_COLOR_DEFAULTS, key)) {
    const value = String(rawValue ?? '').trim();
    return /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  }
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
  if (key === 'clockMoonMode') {
    const value = String(rawValue ?? '').trim();
    return ['light', 'dark', 'auto'].includes(value) ? value : null;
  }
  if (key === 'clockMoonIntervalSeconds') {
    const value = String(rawValue ?? '').trim();
    const seconds = /^\d+$/.test(value) ? Number(value) : NaN;
    return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? String(seconds) : null;
  }
  return null;
}

function getClockConfig(settings = {}) {
  const style = normalizeClockSettingValue('clockStyle', settings.clockStyle) || 'peach';
  const config = {
    style,
    ...(settings.clockStyleParameters === undefined ? {} : { styleParameters:
      JSON.parse(normalizeClockSettingValue('clockStyleParameters', settings.clockStyleParameters) || '{}') }),
    showDate: normalizeClockSettingValue('clockShowDate', settings.clockShowDate) !== 'false',
    showSeconds: normalizeClockSettingValue('clockShowSeconds', settings.clockShowSeconds) !== 'false',
    hourFormat: normalizeClockSettingValue('clockHourFormat', settings.clockHourFormat) || '24',
    label: cleanClockLabel(settings.clockLabel) || DEFAULT_LABELS[style],
    flipFrameColor:
      normalizeClockSettingValue('clockFlipFrameColor', settings.clockFlipFrameColor) || CLOCK_COLOR_DEFAULTS.clockFlipFrameColor,
    flipFaceColor:
      normalizeClockSettingValue('clockFlipFaceColor', settings.clockFlipFaceColor) || CLOCK_COLOR_DEFAULTS.clockFlipFaceColor,
    flipTextColor:
      normalizeClockSettingValue('clockFlipTextColor', settings.clockFlipTextColor) || CLOCK_COLOR_DEFAULTS.clockFlipTextColor,
    moonMode: normalizeClockSettingValue('clockMoonMode', settings.clockMoonMode) || 'light',
    moonIntervalSeconds: Number(normalizeClockSettingValue('clockMoonIntervalSeconds', settings.clockMoonIntervalSeconds) || 30),
  };
  if (settings.clockStyleOptions === undefined) return config;
  const options = clockStyleOptions(config, JSON.parse(normalizeClockSettingValue('clockStyleOptions', settings.clockStyleOptions) || '{}'));
  return { ...config, ...options[style], styleOptions: options };
}

function normalizeClockStyleOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('时钟样式参数无效。');
  return Object.fromEntries(Object.entries(value).map(([style, fields]) => {
    if (!CLOCK_STYLE_VALUES.has(style) || !fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('时钟样式参数无效。');
    return [style, Object.fromEntries(Object.entries(fields).map(([field, input]) => {
      if (!Object.hasOwn(CLOCK_APPEARANCE_KEYS, field)) throw new Error('时钟样式参数无效。');
      const normalized = normalizeClockSettingValue(CLOCK_APPEARANCE_KEYS[field], input);
      if (normalized === null) throw new Error('时钟样式参数无效。');
      return [field, field.startsWith('show') ? normalized === 'true' : field === 'moonIntervalSeconds' ? Number(normalized) : normalized];
    }))];
  }));
}

module.exports = {
  CLOCK_SETTING_KEYS,
  CLOCK_STYLE_VALUES,
  DEFAULT_LABELS,
  cleanClockLabel,
  getClockConfig,
  normalizeClockSettingValue,
  normalizeClockStyleOptions,
};
