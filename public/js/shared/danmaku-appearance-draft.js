export function readAppearanceValue(key, rawValue, min, max) {
  if (key === 'minGiftAmount') {
    const value = Number(rawValue);
    if (!rawValue.trim() || !Number.isFinite(value) || value < Number(min) || value > Number(max)
      || Number(value.toFixed(2)) !== value) throw new Error(`请输入 ${min}～${max} 元，最多两位小数。`);
    return value;
  }
  if (!['fontSize', 'backgroundOpacity', 'floatingSpeed', 'floatingDispersion', 'centerBias', 'dispersion'].includes(key)) return rawValue;
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
  return replaceStyleOptions(draft, { ...draft.styleOptions[draft.style], [key]: value });
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
  return replaceStyleOptions(draft, {});
}

export function isValidFullscreenDuration(value) {
  return Number.isInteger(value) && value >= 2 && value <= 30;
}
