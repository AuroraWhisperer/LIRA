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

export const GIFT_THANKS_SCENES = Object.freeze({
  gift: '礼物答谢', captain: '舰长答谢', admiral: '提督答谢', governor: '总督答谢',
});
export const GIFT_THANKS_MESSAGE_LIMIT = 20;

export function createGiftThanksReplies(templates = DEFAULT_GIFT_THANKS_TEMPLATES) {
  const legacy = normalizeGiftThanksTemplates(templates);
  return Object.fromEntries(Object.keys(GIFT_THANKS_SCENES).map(kind => [kind, {
    enabled: true, mode: 'plain', messages: [{ text: legacy[kind === 'gift' ? 'gift' : 'guard'] }],
  }]));
}

export function normalizeGiftThanksReplies(value) {
  const invalid = () => {
    throw Object.assign(new Error('INVALID_GIFT_THANKS_REPLIES'), { code: 'INVALID_GIFT_THANKS_REPLIES' });
  };
  const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
  if (!exactKeys(value, Object.keys(GIFT_THANKS_SCENES))) invalid();
  return Object.fromEntries(Object.keys(GIFT_THANKS_SCENES).map(kind => {
    const group = value[kind];
    if (!exactKeys(group, ['enabled', 'mode', 'messages']) || typeof group.enabled !== 'boolean'
      || !['plain', 'mention'].includes(group.mode)
      || !Array.isArray(group.messages) || !group.messages.length || group.messages.length > GIFT_THANKS_MESSAGE_LIMIT) invalid();
    const messages = group.messages.map(message => {
      if (!exactKeys(message, ['text'])
        || typeof message.text !== 'string' || !message.text.trim() || Array.from(message.text.trim()).length > 120
        || /[\x00-\x1f\x7f]/u.test(message.text)) invalid();
      const parts = splitGiftThanksTemplate(message.text);
      if (Object.keys(GIFT_THANKS_TOKENS).some(token => parts.filter(part => part === token).length > 1)
        || parts.some(part => !Object.hasOwn(GIFT_THANKS_TOKENS, part) && /[{}]/u.test(part))) invalid();
      return { text: message.text.trim() };
    });
    return [kind, { enabled: group.enabled, mode: group.mode, messages }];
  }));
}

export function chooseGiftThanksReply(replies, kind, random = Math.random) {
  const group = replies[kind];
  if (!group?.enabled) return null;
  return { mode: group.mode, text: group.messages[Math.floor(random() * group.messages.length)].text };
}

export function renderGiftThanksTemplate(template, { name, gifts, amount, amountBlocks }, limit = 40, { requireName = true } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) return null;
  const parts = splitGiftThanksTemplate(template);
  if (!amount) {
    const index = parts.indexOf('{金额}');
    if (index > 0 && !Object.hasOwn(GIFT_THANKS_TOKENS, parts[index - 1])) {
      parts[index - 1] = parts[index - 1].replace(/[；;，,、：:\s]+$/u, '');
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
  return segments.length <= 4 && (!requireName || segments[0]?.includes(name)) ? segments : null;
}
