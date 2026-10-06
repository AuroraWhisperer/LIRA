export const CLOCK_STYLE_LABELS = Object.freeze({
  peach: '今天也要闪闪发光', starlight: '今晚与星星一起值班', soda: '今天也要元气满满',
  'timeline-horizontal': '', 'timeline-vertical': '', digital: '', orbit: '', flip: '', 'moonlit-fan': '',
});
export const FLIP_PALETTES = Object.freeze({
  light: ['#e4e4e4', '#ffffff', '#303030'], dark: ['#757575', '#353535', '#ffffff'],
  lilac: ['#cb69e3', '#ffffff', '#bc59d6'],
});

export function readClockMoonConfig(source) {
  const interval = String(source.moonIntervalSeconds ?? '').trim();
  const seconds = /^\d+$/.test(interval) ? Number(interval) : NaN;
  return {
    moonMode: ['light', 'dark', 'auto'].includes(source.moonMode) ? source.moonMode : 'light',
    moonIntervalSeconds: Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? seconds : 30,
  };
}

export function clockSettingsPayload(config) {
  return { clockStyle: config.style, clockShowDate: config.showDate ? 'true' : 'false',
    clockShowSeconds: config.showSeconds ? 'true' : 'false', clockHourFormat: config.hourFormat,
    clockLabel: config.label, clockFlipFrameColor: config.flipFrameColor || FLIP_PALETTES.light[0],
    clockFlipFaceColor: config.flipFaceColor || FLIP_PALETTES.light[1],
    clockFlipTextColor: config.flipTextColor || FLIP_PALETTES.light[2],
    clockMoonMode: config.moonMode ?? 'light', clockMoonIntervalSeconds: String(config.moonIntervalSeconds ?? 30) };
}

export function clockConfigFromSettings(settings) {
  const style = Object.hasOwn(CLOCK_STYLE_LABELS, settings.clockStyle) ? settings.clockStyle : 'peach';
  return { style, showDate: settings.clockShowDate !== 'false', showSeconds: settings.clockShowSeconds !== 'false',
    hourFormat: settings.clockHourFormat === '12' ? '12' : '24', label: settings.clockLabel || CLOCK_STYLE_LABELS[style],
    flipFrameColor: settings.clockFlipFrameColor || FLIP_PALETTES.light[0],
    flipFaceColor: settings.clockFlipFaceColor || FLIP_PALETTES.light[1],
    flipTextColor: settings.clockFlipTextColor || FLIP_PALETTES.light[2],
    ...readClockMoonConfig({ moonMode: settings.clockMoonMode, moonIntervalSeconds: settings.clockMoonIntervalSeconds }) };
}
