'use strict';

const crypto = require('node:crypto');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}
function invalid(code = 'DAILY_BOT_INVALID_REQUEST') {
  throw Object.assign(new Error(code), { code });
}
function exact(input, keys, required = keys) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key)) ||
    required.some((key) => !Object.hasOwn(input, key))
  )
    invalid();
}
function sanitizeTakeover(value) {
  if (
    !value ||
    !['pending', 'importing', 'ready'].includes(value.state) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    ![null, 'no-legacy', 'fresh-start', 'imported'].includes(value.decision) ||
    (value.state === 'ready') !== (value.decision !== null)
  )
    invalid('DAILY_BOT_INVALID_RESPONSE');
  return {
    state: value.state,
    decision: value.decision,
    revision: value.revision,
    legacyStoppedAt: typeof value.legacyStoppedAt === 'string' ? value.legacyStoppedAt : null,
    importId:
      typeof value.importId === 'string' && /^[A-Za-z0-9-]{16,80}$/.test(value.importId) ? value.importId : null,
    sourceDigest:
      typeof value.sourceDigest === 'string' && /^[a-f0-9]{64}$/.test(value.sourceDigest) ? value.sourceDigest : null,
  };
}
function sanitizeSettings(value) {
  if (value?.executionOwner !== 'server' || !Number.isFinite(Date.parse(value.observedAt)))
    invalid('DAILY_BOT_INVALID_RESPONSE');
  const result = {
    executionOwner: 'server',
    observedAt: new Date(value.observedAt).toISOString(),
    takeover: sanitizeTakeover(value.takeover),
  };
  const reasons = [
    'pending',
    'importing',
    'disabled',
    'running',
    'streamer-disabled',
    'monitor-disabled',
    'room-not-set',
    'waiting-login',
    'monitor-disconnected',
  ];
  for (const kind of ['checkin', 'fortune']) {
    const item = value[kind];
    if (
      !item ||
      typeof item.enabled !== 'boolean' ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 0 ||
      !reasons.includes(item.reason)
    )
      invalid('DAILY_BOT_INVALID_RESPONSE');
    result[kind] = { enabled: item.enabled, revision: item.revision, reason: item.reason };
  }
  return result;
}
module.exports = { canonical, digest, invalid, exact, sanitizeTakeover, sanitizeSettings };
