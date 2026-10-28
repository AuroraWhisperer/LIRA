import { DANMAKU_OPTION_FIELDS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, inspectComposerText, isRandomDanmakuStyle } from './danmaku-style-options.js';

export function readAppearanceValue(key, rawValue, min, max) {
  if (key === 'composerText') {
    const { text, error } = inspectComposerText(rawValue);
    if (error) throw new Error(error);
    return text || undefined;
  }
  if (key === 'minGiftAmount') {
    const value = Number(rawValue);
    if (!rawValue.trim() || !Number.isFinite(value) || value < Number(min) || value > Number(max)
      || Number(value.toFixed(2)) !== value) throw new Error(`请输入 ${min}～${max} 元，最多两位小数。`);
    return value;
  }
  if (key !== 'floatingSpeed' && DANMAKU_OPTION_FIELDS[key]?.type !== 'number') return rawValue;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < Number(min) || value > Number(max)) {
    throw new Error(`请输入 ${min}～${max} 之间的整数。`);
  }
  return value;
}

function replaceStyleOptions(draft, options) {
  return { ...draft, styleOptions: { ...draft.styleOptions, [draft.style]: options } };
}

export function editStyleOption(draft, key, value) {
  if (key === 'floatingSpeed') {
    key = 'speedPixelsPerSecond';
    value = floatingSpeedToPixelsPerSecond(value);
  }
  const options = { ...draft.styleOptions[draft.style] };
  if (value === undefined) delete options[key];
  else options[key] = value;
  return replaceStyleOptions(draft, options);
}

export function floatingSpeedToPixelsPerSecond(value) {
  return Math.round(120 * 3 ** ((value - 50) / (value <= 50 ? 49 : 50)));
}

export function floatingSpeedFromPixelsPerSecond(value) {
  const exponent = Math.log(value / 120) / Math.log(3);
  return Math.max(1, Math.min(100, Math.round(50 + exponent * (value <= 120 ? 49 : 50))));
}

export function floatingSpeedLabel(speed) {
  const level = floatingSpeedFromPixelsPerSecond(speed);
  const multiplier = Number((speed / 120).toFixed(2));
  return `${level} · ${multiplier}×${speed < 40 || speed > 360 ? '（旧值）' : ''}`;
}

export function resetStyleOptions(draft) {
  // An explicit default overrides the legacy shared lifetime without changing other styles.
  const options = isRandomDanmakuStyle(draft.style) && isValidFullscreenDuration(draft.fullscreenDurationSeconds)
    && draft.fullscreenDurationSeconds !== 6 ? { durationSeconds: 6 } : {};
  return replaceStyleOptions(draft, options);
}

export function resetSpookyColors(draft) {
  const options = { ...draft.styleOptions[draft.style] };
  for (const key of [...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS]) delete options[key];
  return replaceStyleOptions(draft, options);
}

export function isValidFullscreenDuration(value) {
  return Number.isInteger(value) && value >= 2 && value <= 30;
}
