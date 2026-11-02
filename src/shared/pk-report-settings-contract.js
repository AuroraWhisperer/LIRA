'use strict';

const { normalizeWelcomeMessages } = require('./welcome-settings-contract');

const BOOLEAN_FIELDS = ['enabled', 'reportEnabled', 'visitorWelcomeEnabled'];
const EXTENSION_FIELDS = ['reportEnabled', 'visitorWelcomeEnabled', 'visitorWelcomeDelaySeconds', 'visitorWelcomeMessages'];
const FIELDS = ['enabled', ...EXTENSION_FIELDS];

function pkReportParameters(value) {
  const fail = () => {
    throw Object.assign(new Error(), { code: 'INVALID_PK_REPORT_SETTINGS' });
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length ||
    Object.keys(value).some((key) => !FIELDS.includes(key))) fail();
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (BOOLEAN_FIELDS.includes(key) && typeof field !== 'boolean') fail();
    if (key === 'visitorWelcomeDelaySeconds' && (!Number.isInteger(field) || field < 0 || field > 300)) fail();
    if (key === 'visitorWelcomeMessages') {
      try {
        result[key] = normalizeWelcomeMessages(field);
      } catch {
        fail();
      }
    } else result[key] = field;
  }
  return result;
}

function sanitizePkReportSettings(value) {
  try {
    if (value?.ok !== true || typeof value.enabled !== 'boolean') throw new Error();
    const extended = EXTENSION_FIELDS.some((key) => Object.hasOwn(value, key));
    if (extended && EXTENSION_FIELDS.some((key) => !Object.hasOwn(value, key))) throw new Error();
    return { ok: true, ...pkReportParameters(Object.fromEntries(
      FIELDS.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
    )) };
  } catch {
    throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
  }
}

module.exports = { pkReportParameters, sanitizePkReportSettings };
