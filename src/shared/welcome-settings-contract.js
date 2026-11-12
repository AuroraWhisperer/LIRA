'use strict';

const { normalizeTimeWelcomeMessages } = require('../../public/js/shared/welcome-time-periods.js');

const NUMBER_RANGES = {
  welcomeDelaySeconds: [0, 300],
  welcomeMinHonorLevel: [0, 999],
  greetingDelaySeconds: [1, 600],
  greetingMinHonorLevel: [0, 999],
  attentionMinHonorLevel: [1, 999],
};
const BOOLEAN_FIELDS = ['enabled', 'greetingEnabled', 'attentionEnabled', 'rareNamePinyinEnabled', 'returningEnabled', 'timeWelcomeEnabled', 'welcomeOwnMedalOnly'];
const LIBRARY_FIELDS = ['messages', 'greetingMessages', 'attentionWelcomeMessages', 'attentionGreetingMessages', 'returningMessages'];
const AUDIENCE_FIELDS = ['welcomeWhitelist', 'welcomeBlacklist'];
const WELCOME_FIELDS = [...BOOLEAN_FIELDS, ...Object.keys(NUMBER_RANGES), ...LIBRARY_FIELDS, ...AUDIENCE_FIELDS, 'userWelcomeMessages', 'timeWelcomeMessages'];
const REQUIRED_FIELDS = WELCOME_FIELDS.filter((key) => ![...AUDIENCE_FIELDS, 'userWelcomeMessages', 'returningEnabled', 'returningMessages', 'timeWelcomeEnabled', 'timeWelcomeMessages', 'welcomeOwnMedalOnly'].includes(key));
const ERROR_REASONS = [
  'BOOLEAN_REQUIRED',
  'OUT_OF_RANGE',
  'INVALID_MESSAGES',
  'INVALID_USERS',
  'WELCOME_REQUIRED',
  'AFTER_WELCOME_REQUIRED',
];

function sanitizeWelcomeFieldErrors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => WELCOME_FIELDS.includes(item?.field) && ERROR_REASONS.includes(item?.reason))
    .slice(0, WELCOME_FIELDS.length)
    .map(({ field, reason }) => ({ field, reason }));
}

function normalizeWelcomeMessages(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 30 ||
    value.some(
      (item) =>
        typeof item !== 'string' || !item.trim() || Array.from(item).length > 80 || /[\x00-\x1f\x7f]/u.test(item),
    )
  )
    throw Object.assign(new Error(), { code: 'INVALID_WELCOME_MESSAGES' });
  return value.map((item) => item.trim());
}

function welcomeV2Parameters(value) {
  const fail = (code = 'INVALID_WELCOME_SETTINGS') => {
    throw Object.assign(new Error(), { code });
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.keys(value).length ||
    Object.keys(value).some((key) => !WELCOME_FIELDS.includes(key))
  )
    fail();
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (BOOLEAN_FIELDS.includes(key) && typeof field !== 'boolean') fail();
    const range = NUMBER_RANGES[key];
    if (range && (!Number.isInteger(field) || field < range[0] || field > range[1])) fail();
    if (AUDIENCE_FIELDS.includes(key)) {
      if (!Array.isArray(field) || field.length > 100 || new Set(field).size !== field.length ||
        field.some((uid) => typeof uid !== 'string' || !/^[1-9]\d{0,19}$/.test(uid)))
        throw Object.assign(new Error(), {
          code: 'INVALID_WELCOME_SETTINGS',
          fieldErrors: [{ field: key, reason: 'INVALID_USERS' }],
        });
      result[key] = [...field];
    } else if (key === 'userWelcomeMessages') {
      try {
        if (!Array.isArray(field) || field.length > 100) fail('INVALID_WELCOME_MESSAGES');
        const uids = new Set();
        result[key] = field.map((item) => {
          if (
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            Object.keys(item).some((name) => !['uid', 'message'].includes(name)) ||
            typeof item.uid !== 'string' ||
            !/^[1-9]\d{0,19}$/.test(item.uid) ||
            uids.has(item.uid)
          )
            fail('INVALID_WELCOME_MESSAGES');
          uids.add(item.uid);
          return { uid: item.uid, message: normalizeWelcomeMessages([item.message])[0] };
        });
      } catch {
        throw Object.assign(new Error(), {
          code: 'INVALID_WELCOME_MESSAGES',
          fieldErrors: [{ field: key, reason: 'INVALID_MESSAGES' }],
        });
      }
    } else if (key === 'timeWelcomeMessages') {
      try {
        result[key] = normalizeTimeWelcomeMessages(field, normalizeWelcomeMessages, true);
      } catch {
        throw Object.assign(new Error(), {
          code: 'INVALID_WELCOME_MESSAGES',
          fieldErrors: [{ field: key, reason: 'INVALID_MESSAGES' }],
        });
      }
    } else if (LIBRARY_FIELDS.includes(key)) {
      result[key] = normalizeWelcomeMessages(field);
    } else result[key] = field;
  }
  return result;
}

function sanitizeWelcomeV2(value) {
  try {
    if (value?.ok === false || value?.schemaVersion !== 2 || REQUIRED_FIELDS.some((key) => !Object.hasOwn(value, key)))
      throw new Error();
    const settings = welcomeV2Parameters(Object.fromEntries(
      WELCOME_FIELDS.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
    ));
    if (Object.hasOwn(settings, 'timeWelcomeMessages'))
      normalizeTimeWelcomeMessages(settings.timeWelcomeMessages, normalizeWelcomeMessages);
    if (
      (Object.hasOwn(settings, 'returningEnabled') !== Object.hasOwn(settings, 'returningMessages')) ||
      (Object.hasOwn(settings, 'timeWelcomeEnabled') !== Object.hasOwn(settings, 'timeWelcomeMessages')) ||
      (Object.hasOwn(settings, 'welcomeWhitelist') !== Object.hasOwn(settings, 'welcomeBlacklist')) ||
      (!settings.enabled && (settings.greetingEnabled || settings.attentionEnabled || settings.returningEnabled)) ||
      (settings.greetingEnabled && settings.greetingDelaySeconds <= settings.welcomeDelaySeconds)
    )
      throw new Error();
    return { ok: true, schemaVersion: 2, ...settings };
  } catch {
    throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
  }
}

module.exports = { welcomeV2Parameters, sanitizeWelcomeV2, sanitizeWelcomeFieldErrors, normalizeWelcomeMessages };
