'use strict';

const { DAY_MS, dayOf, dayStart } = require('./dates');
const { prepareMembership } = require('./membership');
const { buildReminders } = require('./reminders');
const { accompanySettings } = require('./guard-accompany');

const REMINDER_RECORD_KINDS = new Set(['membership', 'anniversary', 'followup', 'caution']);

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
  let activeScope;
  function selectScope(scope) {
    if (scope !== activeScope) {
      cache.clear();
      activeScope = scope;
    }
  }
  function project(scope, profile, records, states, at, settings, daysAhead = 7) {
    selectScope(scope);
    const inputs = records.filter(record => REMINDER_RECORD_KINDS.has(record.kind)).map(({ id, kind, occurredAt, data, original }) => ({
      id, kind, occurredAt,
      data: {
        type: data.type, decision: data.decision, excluded: data.excluded, archived: data.archived,
        startAt: data.startAt, endAt: data.endAt, observedAt: data.observedAt, precision: data.precision,
        level: data.level, totalDays: data.totalDays, continuousDays: data.continuousDays,
        asOf: data.asOf, date: data.date, cycleId: data.cycleId,
        name: data.name, annual: data.annual, advanceDays: data.advanceDays,
        reviewDate: data.reviewDate, completed: data.completed,
      },
      original: { source: original?.source },
    }));
    const snapshot = {
      id: profile.id, alias: profile.alias, platformName: profile.platformName,
      archived: profile.archived, birthday: profile.birthday,
      expiryReminders: profile.expiryReminders, milestoneReminders: profile.milestoneReminders,
      guardAccompany: profile.guardAccompany,
      guardRoster: profile.guardRoster && { roomId: profile.guardRoster.roomId,
        level: profile.guardRoster.level, observedAt: profile.guardRoster.observedAt },
    };
    // Compare actual inputs: restore, rollback and imported revisions may reuse
    // a revision or timestamp. Identity observation times and note bodies do not
    // affect reminders and must not retain private history in this working set.
    const signature = JSON.stringify([snapshot, inputs, states, accompanySettings(settings)]);
    let entry = cache.get(profile.id);
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
    cache.set(profile.id, entry);
    if (!entry.windows.has(daysAhead)) entry.windows.set(daysAhead, entry.readReminders(daysAhead));
    return structuredClone({ membership: entry.membership, reminders: entry.windows.get(daysAhead) });
  }
  // A fixed LRU evicts every entry on the next full scan once the inventory
  // exceeds its capacity. Retain the current account's actual working set.
  project.retain = (scope, profiles) => {
    selectScope(scope);
    const ids = new Set(profiles.map(profile => profile.id));
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  };
  project.drop = (scope, id) => {
    selectScope(scope);
    cache.delete(id);
  };
  return project;
}

module.exports = { createFanProfileProjection };
