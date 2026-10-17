export const TEXT_FORMAT_KEYS = Object.freeze(['bold', 'italic', 'underline', 'stroke', 'shadow', 'fontSize', 'color', 'fontFamily']);

export function normalizeTextFormat(input) {
  const format = {};
  for (const key of TEXT_FORMAT_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    const valid = key === 'fontSize' ? Number.isInteger(value) && value >= 8 && value <= 240
      : key === 'color' ? typeof value === 'string' && /^#[a-f\d]{6}(?:[a-f\d]{2})?$/i.test(value)
      : key === 'fontFamily' ? typeof value === 'string' && value.trim().length > 0 && value.length <= 200
        && !/[\u0000-\u001f\u007f;{}<>]/.test(value)
      : typeof value === 'boolean';
    if (!valid) throw new TypeError('文字格式无效。');
    format[key] = key === 'color' ? value.toLowerCase() : value;
  }
  return format;
}
