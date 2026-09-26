'use strict';

const { DAY_MS, dayOf, dayStart, addDays, daysBetween } = require('./dates');

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
  const days = intervals
    .filter((item) => item.start <= at)
    .map((item) => ({
      start: Math.max(dayStart(dayOf(item.start)), after ? dayStart(addDays(after, 1)) : -Infinity),
      end: dayStart(addDays(dayOf(Math.min(item.end - 1, at)), 1)),
    }))
    .filter((item) => item.end > item.start);
  return unionIntervals(days).reduce((total, item) => total + Math.round((item.end - item.start) / DAY_MS), 0);
}

function summarizeMembership(records, atValue = Date.now()) {
  const at =
    typeof atValue === 'number'
      ? atValue
      : /^\d{4}-\d{2}-\d{2}$/.test(atValue)
        ? dayStart(atValue) + DAY_MS - 1
        : Date.parse(atValue);
  const today = dayOf(at);
  const all = records.filter((r) => r.kind === 'membership' && !r.data.excluded);
  const pending = all.filter((r) => r.data.decision === 'pending');
  const adopted = all.filter((r) => r.data.decision === 'adopted');
  const intervals = adopted
    .filter((r) => r.data.type === 'interval')
    .map((r) => ({
      start: Date.parse(r.data.startAt),
      end: Date.parse(r.data.endAt),
      record: r,
    }));
  const merged = unionIntervals(intervals);
  const active = intervals.filter((r) => r.start <= at && at < r.end);
  const latest = intervals.filter((r) => r.start <= at).sort((a, b) => b.end - a.end)[0];
  const observations = adopted
    .filter((r) => r.data.type === 'observation' && Date.parse(r.data.observedAt) <= at)
    .sort((a, b) => b.data.observedAt.localeCompare(a.data.observedAt));
  const unknownRenewal = observations[0] && (!latest || Date.parse(observations[0].data.observedAt) >= latest.end);
  const bases = adopted
    .filter((r) => r.data.type === 'baseline' && r.data.asOf <= today)
    .sort((a, b) => b.data.asOf.localeCompare(a.data.asOf) || b.occurredAt.localeCompare(a.occurredAt));
  const totalBase = bases.find((r) => r.data.totalDays !== null);
  const continuousBase = bases.find((r) => r.data.continuousDays !== null);
  const segment = merged.find((r) => r.start <= at && at < r.end);
  const recordedDays = coveredDays(merged, at);
  const totalDays = totalBase
    ? totalBase.data.totalDays + coveredDays(merged, at, totalBase.data.asOf)
    : intervals.length
      ? recordedDays
      : null;
  let continuousDays = segment ? daysBetween(dayOf(segment.start), today) + 1 : null;
  let continuousAsOf = segment ? today : null;
  let cycleId = active.sort((a, b) => a.start - b.start)[0]?.record.data.cycleId || null;
  if (continuousBase) {
    const base = continuousBase.data;
    const extension = merged.find(
      (r) => r.start <= dayStart(addDays(base.asOf, 1)) && r.end > dayStart(addDays(base.asOf, 1)),
    );
    if (today === base.asOf || (extension && extension.end > at && extension.start <= at)) {
      continuousDays = base.continuousDays + coveredDays([extension].filter(Boolean), at, base.asOf);
      continuousAsOf = today;
      cycleId = base.cycleId;
    } else if (!segment) {
      continuousDays = base.continuousDays;
      continuousAsOf = base.asOf;
      cycleId = base.cycleId;
    }
  }
  const first = adopted
    .filter((r) => r.data.type === 'first')
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
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
    totalAsOf: totalBase && !coveredDays(merged, at, totalBase.data.asOf) ? totalBase.data.asOf : today,
    totalBasis: totalBase ? '含手动补录' : '已记录',
    cycleId,
    expiry: expiry
      ? {
          at: new Date(expiry.end).toISOString(),
          date: dayOf(expiry.end - 1),
          source: expiry.record.original.source,
          precision: expiry.record.data.precision,
          recordId: expiry.record.id,
        }
      : null,
    pending: pending.map((r) => r.id),
    hasHistory: all.length > 0,
    datePrecision: intervals.some((r) => r.record.data.precision === 'date'),
  };
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
  membershipConflicts,
  cycleForNewRecord,
  coveredDays,
  unionIntervals,
};
