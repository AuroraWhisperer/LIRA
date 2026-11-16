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

// Match color-mix(in srgb), including premultiplied alpha for translucent colors.
export function mixColor(first, second, weight) {
  const firstAlpha = first.alpha * weight;
  const secondAlpha = second.alpha * (1 - weight);
  const alpha = firstAlpha + secondAlpha;
  const channel = key => alpha ? (first[key] * firstAlpha + second[key] * secondAlpha) / alpha : 0;
  return { r: channel('r'), g: channel('g'), b: channel('b'), alpha };
}

// Keep CSS colors, their opacity channels and authored tints in sync on older browser sources.
export function setColorProperties(style, name, value, tints = {}) {
  const color = parseHexColor(value);
  const write = (property, channels, cssColor) => {
    for (const [suffix, token] of [['', cssColor], ['-rgb', channels && `${channels.r} ${channels.g} ${channels.b}`],
      ['-alpha', channels?.alpha]]) {
      if (channels) style.setProperty(`${property}${suffix}`, String(token));
      else style.setProperty(`${property}${suffix}`, '');
    }
  };
  write(name, color, value);
  for (const [suffix, [other, weight]] of Object.entries(tints)) {
    const mixed = color && mixColor(color, parseHexColor(other), weight);
    write(`${name}-${suffix}`, mixed, mixed && `rgba(${mixed.r}, ${mixed.g}, ${mixed.b}, ${mixed.alpha})`);
  }
}
