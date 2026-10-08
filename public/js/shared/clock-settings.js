import { normalizeStyleParameters } from './component-style-parameters.js';

export const CLOCK_STYLE_LABELS = Object.freeze({
  peach: '今天也要闪闪发光', starlight: '今晚与星星一起值班', soda: '今天也要元气满满',
  'timeline-horizontal': '', 'timeline-vertical': '', digital: '', orbit: '', flip: '', 'moonlit-fan': '',
});
export const FLIP_PALETTES = Object.freeze({
  light: ['#e4e4e4', '#ffffff', '#303030'], dark: ['#757575', '#353535', '#ffffff'],
  lilac: ['#cb69e3', '#ffffff', '#bc59d6'],
});
export const CLOCK_APPEARANCE_KEYS = Object.freeze({ showDate: 'clockShowDate', showSeconds: 'clockShowSeconds',
  hourFormat: 'clockHourFormat', label: 'clockLabel', flipFrameColor: 'clockFlipFrameColor',
  flipFaceColor: 'clockFlipFaceColor', flipTextColor: 'clockFlipTextColor', moonMode: 'clockMoonMode',
  moonIntervalSeconds: 'clockMoonIntervalSeconds' });

export function clockStyleOptions(config, saved = {}) {
  const appearance = Object.fromEntries(Object.keys(CLOCK_APPEARANCE_KEYS).map(key => [key, config[key]]));
  const defaultLabel = !config.label || config.label === CLOCK_STYLE_LABELS[config.style];
  return Object.fromEntries(Object.keys(CLOCK_STYLE_LABELS).map(style => [style, {
    ...appearance, ...(defaultLabel ? { label: CLOCK_STYLE_LABELS[style] } : {}), ...saved[style],
  }]));
}

export function clockAppearanceChange(config, patch) {
  return { ...patch, ...(config.styleOptions && !config.resourceStyle && !config.mediaStyle && !config.cssStyle ? { styleOptions: { ...config.styleOptions,
    [config.style]: { ...config.styleOptions[config.style], ...patch } } } : {}) };
}

export function readClockMoonConfig(source) {
  const interval = String(source.moonIntervalSeconds ?? '').trim();
  const seconds = /^\d+$/.test(interval) ? Number(interval) : NaN;
  return {
    moonMode: ['light', 'dark', 'auto'].includes(source.moonMode) ? source.moonMode : 'light',
    moonIntervalSeconds: Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? seconds : 30,
  };
}

export function clockSettingsPayload(config) {
  return { ...(config.styleParameters === undefined ? {} : { clockStyleParameters: JSON.stringify(config.styleParameters) }),
    ...(config.styleOptions === undefined ? {} : { clockStyleOptions: JSON.stringify(config.styleOptions) }),
    clockStyle: config.style, clockShowDate: config.showDate ? 'true' : 'false',
    clockShowSeconds: config.showSeconds ? 'true' : 'false', clockHourFormat: config.hourFormat,
    clockLabel: config.label, clockFlipFrameColor: config.flipFrameColor || FLIP_PALETTES.light[0],
    clockFlipFaceColor: config.flipFaceColor || FLIP_PALETTES.light[1],
    clockFlipTextColor: config.flipTextColor || FLIP_PALETTES.light[2],
    clockMoonMode: config.moonMode ?? 'light', clockMoonIntervalSeconds: String(config.moonIntervalSeconds ?? 30) };
}

export function clockConfigFromSettings(settings) {
  const style = Object.hasOwn(CLOCK_STYLE_LABELS, settings.clockStyle) ? settings.clockStyle : 'peach';
  let styleParameters;
  if (settings.clockStyleParameters !== undefined) {
    try { styleParameters = normalizeStyleParameters('clock', JSON.parse(settings.clockStyleParameters)); }
    catch { styleParameters = {}; }
  }
  const config = { ...(styleParameters === undefined ? {} : { styleParameters }), style, showDate: settings.clockShowDate !== 'false', showSeconds: settings.clockShowSeconds !== 'false',
    hourFormat: settings.clockHourFormat === '12' ? '12' : '24', label: settings.clockLabel || CLOCK_STYLE_LABELS[style],
    flipFrameColor: settings.clockFlipFrameColor || FLIP_PALETTES.light[0],
    flipFaceColor: settings.clockFlipFaceColor || FLIP_PALETTES.light[1],
    flipTextColor: settings.clockFlipTextColor || FLIP_PALETTES.light[2],
    ...readClockMoonConfig({ moonMode: settings.clockMoonMode, moonIntervalSeconds: settings.clockMoonIntervalSeconds }) };
  if (settings.clockStyleOptions === undefined) return config;
  let stored;
  try { stored = JSON.parse(settings.clockStyleOptions); } catch { stored = {}; }
  const options = clockStyleOptions(config, stored || {});
  return { ...config, ...options[style], styleOptions: options };
}
