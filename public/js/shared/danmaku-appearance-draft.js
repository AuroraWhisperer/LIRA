import { DANMAKU_OPTION_FIELDS, DANMAKU_STYLE_OPTIONS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, inspectComposerText, isRandomDanmakuStyle, styleOptionFields, styleOptionsFor } from './danmaku-style-options.js';

export function readAppearanceValue(key, rawValue, min, max) {
  if (DANMAKU_OPTION_FIELDS[key]?.optional && !rawValue.trim()) return undefined;
  if (key === 'composerText') {
    const { text, error } = inspectComposerText(rawValue);
    if (error) throw new Error(error);
    return text || undefined;
  }
  if (DANMAKU_OPTION_FIELDS[key]?.step === .01) {
    const value = Number(rawValue);
    if (!rawValue.trim() || !Number.isFinite(value) || value < Number(min) || value > Number(max)
      || Number(value.toFixed(2)) !== value) throw new Error(`请输入 ${min}～${max} ${DANMAKU_OPTION_FIELDS[key].textRole ? 'px' : '元'}，最多两位小数。`);
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
  // Use authored proportions on every edit so rounded values do not accumulate drift.
  if (DANMAKU_OPTION_FIELDS[key]?.textRole && DANMAKU_OPTION_FIELDS[key].type === 'number') {
    const fields = styleOptionFields(draft.style);
    const resolved = styleOptionsFor(draft.style, draft.styleOptions);
    for (const [sibling, field] of Object.entries(fields)) {
      if (field.legacySizeKey === key && field.linkedSizeKey !== key && !Object.hasOwn(options, sibling)) {
        options[sibling] = resolved[sibling];
      }
      if (field.linkedSizeKey !== key) continue;
      if (value === undefined) delete options[sibling];
      else options[sibling] = Number((value * field.default / fields[key].default).toFixed(2));
    }
  }
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
  const duration = DANMAKU_STYLE_OPTIONS[draft.style]?.defaultDurationSeconds ?? 6;
  const options = isRandomDanmakuStyle(draft.style) && isValidFullscreenDuration(draft.fullscreenDurationSeconds)
    && draft.fullscreenDurationSeconds !== duration ? { durationSeconds: duration } : {};
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
