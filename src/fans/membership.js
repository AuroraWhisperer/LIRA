'use strict';

const { DAY_MS, dayOf, dayStart, dayIndex } = require('./dates');
const { membershipMilestoneDates } = require('./membership-milestones');

function unionIntervals(intervals) {
  const result = [];
  for (const interval of intervals.slice().sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

function coveredDays(intervals, at, after = '') {
  return countCoveredDays(prepareIntervals(intervals), at, after ? dayIndex(dayStart(after)) : -Infinity);
}

function prepareIntervals(intervals) {
  return unionIntervals(intervals).map((item) => ({
    ...item,
    startDay: dayIndex(item.start),
    endDay: dayIndex(item.end - 1) + 1,
  }));
}

function countCoveredDays(intervals, at, after = -Infinity) {
  const endDay = dayIndex(at) + 1;
  let previousEnd = -Infinity;
  let total = 0;
  for (const item of intervals) {
    if (item.start > at) break;
    const start = Math.max(item.startDay, after + 1, previousEnd);
    const end = Math.min(item.endDay, endDay);
    total += Math.max(0, end - start);
    previousEnd = Math.max(previousEnd, end);
  }
  return total;
}

function prepareMembership(records) {
  const all = records.filter((r) => r.kind === 'membership' && !r.data.excluded);
  const pending = all.filter((r) => r.data.decision === 'pending');
  const adopted = all.filter((r) => r.data.decision === 'adopted');
  const intervals = adopted
    .filter((r) => r.data.type === 'interval')
    .map((r) => ({
      start: Date.parse(r.data.startAt),
      end: Date.parse(r.data.endAt),
      record: r,
      expiry: {
        at: new Date(r.data.endAt).toISOString(),
        date: dayOf(Date.parse(r.data.endAt) - 1),
        source: r.original.source,
        precision: r.data.precision,
        recordId: r.id,
      },
    }));
  const merged = prepareIntervals(intervals);
  const orderedIntervals = intervals.slice().sort((a, b) => b.end - a.end);
  const observationsByTime = adopted
    .filter((r) => r.data.type === 'observation')
    .sort((a, b) => b.data.observedAt.localeCompare(a.data.observedAt));
  const baselines = adopted
    .filter((r) => r.data.type === 'baseline')
    .sort((a, b) => b.data.asOf.localeCompare(a.data.asOf) || b.occurredAt.localeCompare(a.occurredAt))
    .map((record) => ({ record, day: dayIndex(dayStart(record.data.asOf)) }));
  const first = adopted
    .filter((r) => r.data.type === 'first')
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const pendingIds = pending.map((r) => r.id);
  const datePrecision = intervals.some((r) => r.record.data.precision === 'date');

  function summarizeAt(atValue = Date.now()) {
    const at = typeof atValue === 'number' ? atValue
      : /^\d{4}-\d{2}-\d{2}$/.test(atValue) ? dayStart(atValue) + DAY_MS - 1 : Date.parse(atValue);
    const today = dayOf(at);
    const currentDay = dayIndex(at);
    const active = intervals.filter((r) => r.start <= at && at < r.end);
    const latest = orderedIntervals.find((r) => r.start <= at);
    const observations = observationsByTime.filter((r) => Date.parse(r.data.observedAt) <= at);
    const unknownRenewal = observations[0] && (!latest || Date.parse(observations[0].data.observedAt) >= latest.end);
    const bases = baselines.filter((r) => r.day <= currentDay);
    const totalBaseline = bases.find((r) => r.record.data.totalDays !== null);
    const continuousBaseline = bases.find((r) => r.record.data.continuousDays !== null);
    const totalBase = totalBaseline?.record;
    const continuousBase = continuousBaseline?.record;
    const segment = merged.find((r) => r.start <= at && at < r.end);
    const recordedDays = countCoveredDays(merged, at);
    const addedDays = totalBase ? countCoveredDays(merged, at, totalBaseline.day) : 0;
    const totalDays = totalBase
      ? totalBase.data.totalDays + addedDays
      : intervals.length
        ? recordedDays
        : null;
    let continuousDays = segment ? currentDay - segment.startDay + 1 : null;
    let continuousAsOf = segment ? today : null;
    let cycleId = active.sort((a, b) => a.start - b.start)[0]?.record.data.cycleId || null;
    if (continuousBase) {
      const base = continuousBase.data;
      const extensionStart = dayStart(base.asOf) + DAY_MS;
      const extension = merged.find(
        (r) => r.start <= extensionStart && r.end > extensionStart,
      );
      if (today === base.asOf || (extension && extension.end > at && extension.start <= at)) {
        continuousDays = base.continuousDays + countCoveredDays(extension ? [extension] : [], at, continuousBaseline.day);
        continuousAsOf = today;
        cycleId = base.cycleId;
      } else if (!segment) {
        continuousDays = base.continuousDays;
        continuousAsOf = base.asOf;
        cycleId = base.cycleId;
      }
    }
    const status = pending.length
      ? 'pending'
      : active.length
        ? 'active'
        : unknownRenewal
          ? 'unknown'
          : latest
            ? 'expired'
            : 'unknown';
    const expiry = segment ? intervals.find((item) => item.end === segment.end) : latest;
    return {
      status,
      level: status === 'active' ? Math.min(...active.map((r) => r.record.data.level)) : null,
      observedLevel: observations[0]?.data.level || null,
      observedAt: observations[0]?.data.observedAt || null,
      firstDate: first?.data.date || '',
      totalDays,
      recordedDays,
      continuousDays,
      continuousAsOf,
      totalAsOf: totalBase && !addedDays ? totalBase.data.asOf : today,
      totalBasis: totalBase ? '含手动补录' : '已记录',
      cycleId,
      expiry: expiry ? { ...expiry.expiry } : null,
      pending: [...pendingIds],
      hasHistory: all.length > 0,
      datePrecision,
    };
  }
  summarizeAt.milestoneDates = (earliest, latest, now) => membershipMilestoneDates(merged, baselines, earliest, latest, now);
  return summarizeAt;
}

function summarizeMembership(records, atValue = Date.now()) {
  return prepareMembership(records)(atValue);
}

function membershipConflicts(candidate, records, excludeId) {
  const adopted = records.filter((r) => r.kind === 'membership' && r.id !== excludeId && r.data.decision === 'adopted');
  const data = candidate.data;
  const conflicts = [];
  for (const record of adopted) {
    const other = record.data;
    if (data.type === 'interval' && other.type === 'interval' && candidate.original.source !== record.original.source) {
      const overlaps = data.startAt < other.endAt && other.startAt < data.endAt;
      if (overlaps && (data.startAt !== other.startAt || data.endAt !== other.endAt || data.level !== other.level))
        conflicts.push(record.id);
    }
    if (data.type === 'baseline' && other.type === 'interval') {
      const summary = summarizeMembership([record], data.asOf);
      if (
        (data.totalDays !== null && summary.totalDays > data.totalDays) ||
        (data.continuousDays !== null && summary.continuousDays > data.continuousDays)
      )
        conflicts.push(record.id);
    }
    if (
      data.type === 'interval' &&
      other.type === 'baseline' &&
      candidate.original.source === 'platform' &&
      dayOf(data.startAt) <= other.asOf
    )
      conflicts.push(record.id);
    if (
      data.type === 'observation' &&
      other.type === 'interval' &&
      data.status === 'inactive' &&
      other.startAt <= data.observedAt &&
      data.observedAt < other.endAt
    )
      conflicts.push(record.id);
  }
  return [...new Set(conflicts)];
}

function cycleForNewRecord(profile, records, candidate) {
  if (candidate.type !== 'interval') return profile.cycleId;
  const earlier = records
    .filter(
      (r) =>
        r.kind === 'membership' &&
        r.data.type === 'interval' &&
        r.data.decision === 'adopted' &&
        r.data.startAt < candidate.startAt,
    )
    .sort((a, b) => b.data.endAt.localeCompare(a.data.endAt))[0];
  if (earlier && earlier.data.endAt < candidate.startAt) return null;
  return profile.cycleId;
}

module.exports = {
  summarizeMembership,
  prepareMembership,
  membershipConflicts,
  cycleForNewRecord,
  coveredDays,
  unionIntervals,
};
