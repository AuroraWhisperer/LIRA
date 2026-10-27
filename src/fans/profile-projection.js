'use strict';

const { DAY_MS, dayOf, dayStart } = require('./dates');
const { prepareMembership } = require('./membership');
const { buildReminders } = require('./reminders');
const { accompanySettings } = require('./guard-accompany');

const REMINDER_RECORD_KINDS = new Set(['membership', 'anniversary', 'followup', 'caution']);
const MAX_CACHED_PROFILES = 1000;

function nextMembershipChange(records, at) {
  let until = dayStart(dayOf(at)) + DAY_MS;
  for (const record of records) {
    if (record.kind !== 'membership') continue;
    for (const value of [record.data.startAt, record.data.endAt, record.data.observedAt]) {
      const time = Date.parse(value);
      if (time > at && time < until) until = time;
    }
  }
  return until;
}

function createFanProfileProjection() {
  const cache = new Map();
  return function project(scope, profile, records, states, at, settings, daysAhead = 7) {
    const inputs = records.filter(record => REMINDER_RECORD_KINDS.has(record.kind)).map(record => ({
      id: record.id, kind: record.kind, occurredAt: record.occurredAt, data: record.data,
      original: { source: record.original?.source },
    }));
    const key = JSON.stringify([scope, profile.id]);
    // Compare actual inputs: restore, rollback and imported revisions may reuse
    // a revision or timestamp. Unrelated song/note records cannot change reminders.
    const signature = JSON.stringify([profile, inputs, states, accompanySettings(settings)]);
    let entry = cache.get(key);
    if (!entry || entry.signature !== signature || at < entry.at || at >= entry.until) {
      const [snapshot, evidence, reminderStates, config] = JSON.parse(signature);
      const raw = prepareMembership(evidence);
      const membership = raw(at);
      const summaries = new Map([[dayOf(at), membership]]);
      const summarize = date => {
        if (!summaries.has(date)) summaries.set(date, raw(date));
        return summaries.get(date);
      };
      summarize.milestoneDates = raw.milestoneDates;
      entry = { signature, at, until: nextMembershipChange(evidence, at), membership, windows: new Map(),
        readReminders: window => buildReminders(snapshot, evidence, reminderStates, at, config,
          { daysAhead: window, summarize, membership }) };
    }
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > MAX_CACHED_PROFILES) cache.delete(cache.keys().next().value);
    if (!entry.windows.has(daysAhead)) entry.windows.set(daysAhead, entry.readReminders(daysAhead));
    return structuredClone({ membership: entry.membership, reminders: entry.windows.get(daysAhead) });
  };
}

module.exports = { createFanProfileProjection };
