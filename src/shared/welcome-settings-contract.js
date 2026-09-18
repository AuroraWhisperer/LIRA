'use strict';

const NUMBER_RANGES = {
  welcomeDelaySeconds: [0, 300], welcomeMinHonorLevel: [0, 999],
  greetingDelaySeconds: [1, 600], greetingMinHonorLevel: [0, 999], attentionMinHonorLevel: [1, 999],
};
const BOOLEAN_FIELDS = ['enabled', 'greetingEnabled', 'attentionEnabled', 'rareNamePinyinEnabled'];
const LIBRARY_FIELDS = ['messages', 'greetingMessages', 'attentionWelcomeMessages', 'attentionGreetingMessages'];
const WELCOME_FIELDS = [...BOOLEAN_FIELDS, ...Object.keys(NUMBER_RANGES), ...LIBRARY_FIELDS];
const ERROR_REASONS = ['BOOLEAN_REQUIRED', 'OUT_OF_RANGE', 'INVALID_MESSAGES', 'WELCOME_REQUIRED', 'AFTER_WELCOME_REQUIRED'];

function sanitizeWelcomeFieldErrors(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => WELCOME_FIELDS.includes(item?.field) && ERROR_REASONS.includes(item?.reason))
    .slice(0, WELCOME_FIELDS.length).map(({ field, reason }) => ({ field, reason }));
}

function welcomeV2Parameters(value) {
  const fail = (code = 'INVALID_WELCOME_SETTINGS') => { throw Object.assign(new Error(), { code }); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length ||
      Object.keys(value).some((key) => !WELCOME_FIELDS.includes(key))) fail();
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (BOOLEAN_FIELDS.includes(key) && typeof field !== 'boolean') fail();
    const range = NUMBER_RANGES[key];
    if (range && (!Number.isInteger(field) || field < range[0] || field > range[1])) fail();
    if (LIBRARY_FIELDS.includes(key)) {
      if (!Array.isArray(field) || field.length < 1 || field.length > 30 ||
          field.some((item) => typeof item !== 'string' || !item.trim() || Array.from(item).length > 80 ||
            /[\x00-\x1f\x7f]/u.test(item))) fail('INVALID_WELCOME_MESSAGES');
      result[key] = field.map((item) => item.trim());
    } else result[key] = field;
  }
  return result;
}

function sanitizeWelcomeV2(value) {
  try {
    if (value?.ok === false || value?.schemaVersion !== 2 || WELCOME_FIELDS.some((key) => !Object.hasOwn(value, key)))
      throw new Error();
    const settings = welcomeV2Parameters(Object.fromEntries(WELCOME_FIELDS.map((key) => [key, value[key]])));
    if ((!settings.enabled && (settings.greetingEnabled || settings.attentionEnabled)) ||
        (settings.greetingEnabled && settings.greetingDelaySeconds <= settings.welcomeDelaySeconds)) throw new Error();
    return { ok: true, schemaVersion: 2, ...settings };
  } catch { throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' }); }
}

module.exports = { welcomeV2Parameters, sanitizeWelcomeV2, sanitizeWelcomeFieldErrors };
