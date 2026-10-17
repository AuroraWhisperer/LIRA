import { colorWithAlpha } from './color-value.js';

export function textColorHex(value) {
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) return value;
  const channels = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  return channels ? colorWithAlpha(`#${channels.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`,
    channels[4] === undefined ? 1 : Number(channels[4])) : null;
}

export function readTextStyle(element, editor, config) {
  const style = getComputedStyle(element);
  const format = {};
  const marks = { bold: Number(style.fontWeight) >= 600, italic: style.fontStyle === 'italic',
    stroke: parseFloat(style.webkitTextStrokeWidth) > 0, shadow: style.textShadow !== 'none', underline: false };
  for (let parent = element; parent && parent !== editor && editor.contains(parent); parent = parent.parentElement) {
    if (getComputedStyle(parent).textDecorationLine.includes('underline')) marks.underline = true;
    if (!format.fontFamily && parent.style.fontFamily && parent.style.fontFamily !== 'inherit') format.fontFamily = parent.style.fontFamily;
  }
  for (const [key, value] of Object.entries(marks)) if (value !== Boolean(config[key])) format[key] = value;
  const size = Math.round(parseFloat(style.fontSize));
  if (size !== config.fontSize) format.fontSize = size;
  const color = textColorHex(style.color);
  if (color && color !== textColorHex(config.color)) format.color = color;
  return format;
}

export function applyTextStyle(element, format, defaults) {
  const color = format.color ?? defaults.color;
  Object.assign(element.style, { fontSize: `${format.fontSize ?? defaults.fontSize}px`,
    fontFamily: format.fontFamily || 'inherit', color,
    fontWeight: (format.bold ?? defaults.bold) ? '700' : '400',
    fontStyle: (format.italic ?? defaults.italic) ? 'italic' : 'normal',
    textDecoration: (format.underline ?? defaults.underline) ? 'underline' : 'none',
    textDecorationColor: color, textDecorationSkipInk: 'none', textUnderlineOffset: '0.12em',
    webkitTextStroke: (format.stroke ?? defaults.stroke) ? defaults.textStroke || '0.1em #000000' : '0px',
    paintOrder: 'stroke fill',
    textShadow: (format.shadow ?? defaults.shadow) ? '0 0.1em 0.12em rgb(0 0 0 / 85%)' : 'none' });
}
