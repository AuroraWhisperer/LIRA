import { normalizeTextFormat, TEXT_FORMAT_KEYS } from './text-format.js';

export const WISH_TEXT_DEFAULTS = Object.freeze({ fontSize: 24, bold: true, stroke: false,
  textStroke: '2px #fffcf6', color: 'inherit' });

export function normalizeGiftWishTextRuns(runs, template) {
  if (!Array.isArray(runs) || runs.length > 240 || typeof template !== 'string') throw new TypeError('许愿文字格式无效。');
  if (!runs.length) return [];
  const normalized = runs.map(run => {
    if (!run || typeof run !== 'object' || Array.isArray(run)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(run))
      || Object.keys(run).some(key => key !== 'text' && !TEXT_FORMAT_KEYS.includes(key))
      || typeof run.text !== 'string' || !run.text.length
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(run.text)) throw new TypeError('许愿文字格式无效。');
    return { text: run.text, ...normalizeTextFormat(run) };
  });
  const content = normalized.map(run => run.text).join('');
  if ([...content].length > 240 || content.trim() !== template.trim()) throw new TypeError('许愿文字与格式不一致。');
  const boundaries = new Set();
  let offset = 0;
  for (const run of normalized) { offset += run.text.length; boundaries.add(offset); }
  for (const token of content.matchAll(/\{(?:图片|礼物|已收|目标)\}/gu)) {
    if ([...boundaries].some(boundary => boundary > token.index && boundary < token.index + token[0].length)) {
      throw new TypeError('许愿内容块不能拆分。');
    }
  }
  let leading = content.length - content.trimStart().length;
  let remaining = content.trim().length;
  return normalized.flatMap(run => {
    const start = Math.min(leading, run.text.length);
    leading -= start;
    const text = run.text.slice(start, start + remaining);
    remaining -= text.length;
    return text ? [{ ...run, text }] : [];
  });
}
