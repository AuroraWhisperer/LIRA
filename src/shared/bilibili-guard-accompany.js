'use strict';

// Platform observations are independent of purchased months and local membership intervals.
function normalizeGuardAccompany(value) {
  if (!value || !Number.isSafeInteger(value.days) || value.days < 0 ||
    typeof value.roomId !== 'string' || !/^[1-9]\d{0,19}$/.test(value.roomId) ||
    !['guard-roster', 'guard-toast'].includes(value.source) ||
    typeof value.observedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.observedAt) ||
    !Number.isFinite(Date.parse(value.observedAt))) return null;
  return {
    days: value.days,
    roomId: value.roomId,
    observedAt: new Date(value.observedAt).toISOString(),
    source: value.source,
  };
}

function newerGuardAccompany(current, incoming) {
  const next = normalizeGuardAccompany(incoming);
  const previous = normalizeGuardAccompany(current);
  if (!next) return previous;
  if (!previous || next.observedAt > previous.observedAt ||
    (next.observedAt === previous.observedAt && next.source === 'guard-toast' && previous.source !== 'guard-toast')) {
    return next;
  }
  return previous;
}

module.exports = { normalizeGuardAccompany, newerGuardAccompany };
