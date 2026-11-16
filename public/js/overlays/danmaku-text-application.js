import { DANMAKU_TEXT_TARGETS, DANMAKU_FONTS } from '../shared/danmaku-style-options.js';

const sheets = new WeakMap();

export function applyDanmakuTextOptions(document, style, options) {
  const rules = [];
  for (const [role, selector] of Object.entries(DANMAKU_TEXT_TARGETS[style] || {})) {
    const declarations = [];
    const font = options[`${role}FontFamily`];
    const size = options[`${role}FontSize`];
    const color = options[`${role}Color`];
    if (font && font !== 'default') {
      declarations.push(`font-family: ${DANMAKU_FONTS[font] || `${font}, ${DANMAKU_FONTS.sans}`} !important`);
    }
    if (size !== undefined) declarations.push(`font-size: ${size}px !important`);
    if (color && color !== 'default') declarations.push(`color: ${color} !important`, `-webkit-text-fill-color: ${color} !important`);
    if (declarations.length) rules.push(`body[data-style='${style}'] :is(${selector}) { ${declarations.join('; ')}; }`);
  }
  let sheet = sheets.get(document);
  if (!sheet && !rules.length) return;
  if (!sheet) {
    sheet = document.createElement('style');
    sheet.dataset.danmakuTextOptions = '';
    document.head.append(sheet);
    sheets.set(document, sheet);
  }
  // One stylesheet covers existing and future messages; no per-message observers or listeners.
  sheet.textContent = rules.join('\n');
}
