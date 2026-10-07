export function readAppearanceValue(key, rawValue, min, max) {
  if (!['fontSize', 'backgroundOpacity', 'speedPixelsPerSecond', 'centerBias', 'dispersion'].includes(key)) return rawValue;
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
  return replaceStyleOptions(draft, { ...draft.styleOptions[draft.style], [key]: value });
}

export function resetStyleOptions(draft) {
  return replaceStyleOptions(draft, {});
}

export function isValidFullscreenDuration(value) {
  return Number.isInteger(value) && value >= 2 && value <= 30;
}
