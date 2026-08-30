'use strict';

const { cleanText, normalizePositiveInteger } = require('../../shared/utils');

const USER_INFO_TTL_MS = 10 * 60 * 1000;
const PROFILE_FAILURE_TTL_MS = 30 * 1000;
const PROFILE_FIELDS = Object.freeze(['name', 'avatarUrl']);
const ROOM_FIELDS = Object.freeze(['guard', 'fansMedal']);
const ALL_FIELDS = Object.freeze([...PROFILE_FIELDS, ...ROOM_FIELDS]);
const SOURCE_AUTHORITY = Object.freeze({
  profile: 0,
  online_rank: 5,
  fans_rank: 10,
  history: 20,
  danmaku: 30,
  superchat: 30,
  gift: 30,
});

function normalizeFields(value, defaults) {
  const explicit = value !== undefined;
  const fields = explicit ? value : defaults;
  if (!Array.isArray(fields)) throw new TypeError('fields must be an array');
  const normalized = [];
  for (const field of fields) {
    if (typeof field !== 'string' || !ALL_FIELDS.includes(field)) {
      throw new TypeError(`Unknown user-info field: ${String(field)}`);
    }
    if (!normalized.includes(field)) normalized.push(field);
  }
  return { fields: normalized, explicit };
}

function normalizeSource(value, diagnostics) {
  const source = cleanText(value);
  if (Object.hasOwn(SOURCE_AUTHORITY, source)) return source;
  const entry = { kind: 'unknown-source', source };
  if (typeof diagnostics === 'function') diagnostics(entry);
  else if (diagnostics && typeof diagnostics.record === 'function') {
    diagnostics.record(entry);
  }
  throw new TypeError(`Unknown user-info source: ${source || '(empty)'}`);
}

function normalizeUid(value) {
  const uid = cleanText(value);
  return /^\d{1,20}$/.test(uid) ? uid : '';
}

function profileEvidence(source, observedAt, extra = {}) {
  return { source, observedAt, authority: SOURCE_AUTHORITY[source], ...extra };
}

function roomEvidence(value, source, observedAt) {
  return {
    value,
    source,
    observedAt,
    authority: SOURCE_AUTHORITY[source],
    verified: true,
  };
}

function shouldReplaceName(current, value, source, observedAt) {
  if (!current) return true;
  const incomingQuality = isMaskedDisplayName(value) ? 0 : 1;
  const currentQuality = current.quality === 'full' ? 1 : 0;
  if (incomingQuality !== currentQuality) {
    return incomingQuality > currentQuality;
  }
  if (observedAt !== current.observedAt) return observedAt > current.observedAt;
  return SOURCE_AUTHORITY[source] >= current.authority;
}

function shouldReplaceProfileField(current, source, observedAt) {
  if (!current) return true;
  if (observedAt !== current.observedAt) return observedAt > current.observedAt;
  return SOURCE_AUTHORITY[source] >= current.authority;
}

function shouldReplaceRoomField(current, incoming, nowMs) {
  if (!incoming.verified) return false;
  if (!current || nowMs - current.observedAt > USER_INFO_TTL_MS) return true;
  if (incoming.authority !== current.authority) {
    return incoming.authority > current.authority;
  }
  return incoming.observedAt >= current.observedAt;
}

function normalizeFansMedal(value) {
  const name = cleanText(value && value.name);
  const level = normalizePositiveInteger(value && value.level);
  const targetUid = normalizeUid(value && value.targetUid);
  if (!name || !targetUid) return null;
  return { name, level, targetUid };
}

function isMaskedDisplayName(value) {
  return /\*{2,}/.test(cleanText(value));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneValue(value) {
  return value && typeof value === 'object' ? { ...value } : value;
}

function emptyIngestResult() {
  return { snapshot: null, changedFields: [] };
}

module.exports = {
  USER_INFO_TTL_MS,
  PROFILE_FAILURE_TTL_MS,
  PROFILE_FIELDS,
  ROOM_FIELDS,
  ALL_FIELDS,
  normalizeFields,
  normalizeSource,
  normalizeUid,
  profileEvidence,
  roomEvidence,
  shouldReplaceName,
  shouldReplaceProfileField,
  shouldReplaceRoomField,
  normalizeFansMedal,
  isMaskedDisplayName,
  sameValue,
  cloneValue,
  emptyIngestResult,
};
