/** Read CSS hexadecimal colors without discarding their alpha channel. */
export function parseHexColor(value) {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(String(value || ''));
  if (!match) return null;
  const digits = match[1].length < 5 ? [...match[1]].map(char => char + char).join('') : match[1];
  const hex = `#${digits.slice(0, 6).toLowerCase()}`;
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16));
  return { hex, r, g, b, alpha: digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1 };
}

export function colorWithAlpha(hex, alpha) {
  const byte = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${hex}${byte === 255 ? '' : byte.toString(16).padStart(2, '0')}`;
}
