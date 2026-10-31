// Keep the portable template contract in sync with Server src/lib/gift-thanks-templates.mjs.
export const GIFT_THANKS_TOKENS = Object.freeze({
  '{称呼}': '观众称呼',
  '{礼物}': '礼物和数量',
  '{金额}': '金额与差额',
});

export const DEFAULT_GIFT_THANKS_TEMPLATES = Object.freeze({
  gift: '感谢{称呼}投喂{礼物}；{金额}',
  guard: '感谢{称呼}开通{礼物}；{金额}',
});

export function splitGiftThanksTemplate(value) {
  return value.split(/(\{(?:称呼|礼物|金额)\})/u).filter(Boolean);
}

export function normalizeGiftThanksTemplates(value) {
  const invalid = () => {
    throw Object.assign(new Error('INVALID_GIFT_THANKS_TEMPLATES'), { code: 'INVALID_GIFT_THANKS_TEMPLATES' });
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'gift') || !Object.hasOwn(value, 'guard')) invalid();
  const result = {};
  for (const kind of ['gift', 'guard']) {
    const text = value[kind];
    if (typeof text !== 'string' || !text.trim() || Array.from(text.trim()).length > 120
      || /[\x00-\x1f\x7f]/u.test(text)) invalid();
    const parts = splitGiftThanksTemplate(text);
    for (const token of Object.keys(GIFT_THANKS_TOKENS)) {
      if (parts.filter(part => part === token).length !== 1) invalid();
    }
    if (parts.some(part => !Object.hasOwn(GIFT_THANKS_TOKENS, part) && /[{}]/u.test(part))) invalid();
    result[kind] = text.trim();
  }
  return result;
}

export function renderGiftThanksTemplate(template, { name, gifts, amount, amountBlocks }, limit = 40) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) return null;
  const parts = splitGiftThanksTemplate(template);
  if (!amount) {
    const index = parts.indexOf('{金额}');
    if (index > 0 && !Object.hasOwn(GIFT_THANKS_TOKENS, parts[index - 1])) {
      parts[index - 1] = parts[index - 1].replace(/[；;，,、：: ]+$/u, '');
    }
  }
  const values = { '{称呼}': name, '{礼物}': gifts.join('、'), '{金额}': amount };
  const whole = parts.map(part => Object.hasOwn(values, part) ? values[part] : part).join('');
  if (whole.length <= limit) return whole ? [whole] : null;

  const segments = [];
  let line = '';
  function append(text, separator = '') {
    if (text.length > limit) return false;
    if ((line + separator + text).length > limit) {
      if (line) segments.push(line);
      line = text;
    } else line += (line ? separator : '') + text;
    return segments.length < 4;
  }
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const part of parts) {
    if (part === '{称呼}') {
      if (!append(name)) return null;
    } else if (part === '{礼物}') {
      for (const [index, gift] of gifts.entries()) {
        if (!append(gift, index ? '、' : '')) return null;
      }
    } else if (part === '{金额}') {
      const blocks = amount.length <= limit ? [amount] : amountBlocks;
      for (const [index, block] of blocks.entries()) {
        if (!append(block, index ? '；' : '')) return null;
      }
    } else {
      for (const { segment } of graphemes.segment(part)) {
        if (!append(segment)) return null;
      }
    }
  }
  if (line) segments.push(line);
  return segments.length <= 4 && segments[0]?.includes(name) ? segments : null;
}
