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
      observedLevel: observations[0]?.data.status === 'inactive' ? null : observations[0]?.data.level || null,
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
      hasHistory: Boolean(latest || (first && first.data.date <= today) ||
        bases.some(({ record }) => record.data.totalDays > 0 || record.data.continuousDays > 0) ||
        observations.some(r => r.data.status !== 'inactive')),
      datePrecision,
    };
  }
  summarizeAt.milestoneDates = (earliest, latest, now, snoozedRules) =>
    membershipMilestoneDates(merged, baselines, earliest, latest, now, snoozedRules);
  return summarizeAt;
}

function summarizeMembership(records, atValue = Date.now()) {
  return prepareMembership(records)(atValue);
}

function inactiveDuringInterval(observation, interval) {
  return observation.type === 'observation' && observation.status === 'inactive' && interval.type === 'interval' &&
    interval.startAt <= observation.observedAt && observation.observedAt < interval.endAt;
}

function exclusiveDaysThrough(intervals, cutoff) {
  const changes = intervals.flatMap(item => [
    { day: dayIndex(item.start), item, starts: true },
    { day: dayIndex(Math.min(item.end, cutoff) - 1) + 1, item, starts: false },
  ]).sort((a, b) => a.day - b.day);
  const active = new Set();
  const exclusive = new Map();
  let previousDay = changes[0].day;
  for (const { day, item, starts } of changes) {
    if (day > previousDay && active.size === 1) {
      const [only] = active;
      exclusive.set(only, (exclusive.get(only) || 0) + day - previousDay);
    }
    if (starts) active.add(item);
    else active.delete(item);
    previousDay = day;
  }
  return exclusive;
}

function finishedTotalConflicts(intervals, cutoff, limit) {
  let ongoing;
  const byDays = new Map();
  for (const item of intervals.toSorted((a, b) => a.start - b.start || b.end - a.end)) {
    if (item.end > cutoff) {
      // All continuing spans cover the cutoff. The earliest covers all their elapsed days.
      ongoing ??= item;
    } else {
      const key = `${dayIndex(item.start)}:${dayIndex(item.end - 1)}`;
      if (!byDays.has(key)) byDays.set(key, { start: item.start, end: item.end, items: [] });
      byDays.get(key).items.push(item);
    }
  }
  const history = [...byDays.values()];
  const days = items => countCoveredDays(prepareIntervals(items), cutoff - 1);
  const conflicts = new Set();
  function review(items, anchor) {
    const reference = anchor ? [anchor] : [];
    if (days([...reference, ...items]) <= limit) return;
    for (const item of items) {
      const group = [...reference, item];
      const excess = days(group) - limit;
      if (excess <= 0) {
        reference.push(item);
        continue;
      }
      conflicts.add(item);
      if (anchor && days([anchor, item]) > limit) continue;
      // Include contradictory pairs as well as periods jointly needed to exceed the limit.
      const exclusive = exclusiveDaysThrough(group, cutoff);
      for (const prior of reference) {
        if (prior === anchor || conflicts.has(prior)) continue;
        const pair = anchor ? [anchor, prior, item] : [prior, item];
        if ((exclusive.get(prior) || 0) >= excess || days(pair) > limit) conflicts.add(prior);
      }
    }
  }
  review(history);
  if (ongoing) review(history.filter(item => !conflicts.has(item)), ongoing);
  return new Set([...conflicts].flatMap(period => period.items));
}

function intervalsExceedingBaseline(baseline, intervals, incoming) {
  const cutoff = dayStart(baseline.asOf) + DAY_MS;
  const at = cutoff - 1;
  const earliestStart = baseline.continuousDays == null ? -Infinity : cutoff - baseline.continuousDays * DAY_MS;
  const exceedsStreak = item => item.start < earliestStart && item.end >= cutoff;
  const conflicts = [];
  let remaining = [];
  for (const record of intervals) {
    const start = Date.parse(record.data.startAt);
    if (start > at) continue;
    const end = Date.parse(record.data.endAt);
    const elapsedDays = dayIndex(Math.min(at, end - 1)) - dayIndex(start) + 1;
    const item = { start, end, record };
    if ((baseline.totalDays != null && elapsedDays > baseline.totalDays) || exceedsStreak(item)) conflicts.push(record);
    else remaining.push(item);
  }
  if (baseline.totalDays != null) {
    const covered = countCoveredDays(prepareIntervals(remaining), at);
    if (covered > baseline.totalDays) {
      if (incoming) {
        const previous = remaining.filter(item => item.record !== incoming);
        if (covered > countCoveredDays(prepareIntervals(previous), at)) conflicts.push(incoming);
      } else {
        const finished = finishedTotalConflicts(remaining, cutoff, baseline.totalDays);
        for (const item of finished) conflicts.push(item.record);
        remaining = remaining.filter(item => !finished.has(item));
      }
    }
  }
  if (baseline.continuousDays == null) return conflicts;

  const streak = unionIntervals(remaining).find(exceedsStreak);
  if (!streak) return conflicts;

  // A split history may prove the whole streak without a later expiry.
  const finished = remaining.filter(item => item.end <= cutoff);
  const history = unionIntervals(finished).find(exceedsStreak);
  const evidence = history ? finished : remaining;
  const start = (history ?? streak).start;
  return conflicts.concat(evidence.filter(item => item.end > start).map(item => item.record));
}

function conflictingBaselines(a, b) {
  if (a.type !== 'baseline' || b.type !== 'baseline' || a.asOf !== b.asOf) return false;
  return ['totalDays', 'continuousDays'].some(key => a[key] != null && b[key] != null && a[key] !== b[key]) ||
    (a.totalDays != null && b.continuousDays != null && a.totalDays < b.continuousDays) ||
    (b.totalDays != null && a.continuousDays != null && b.totalDays < a.continuousDays);
}

function membershipConflicts(candidate, records, excludeId, { independentBaselines = false } = {}) {
  const data = candidate.data;
  if (data.type === 'first' || (data.type === 'observation' && data.status !== 'inactive')) return [];
  const adopted = records.filter((r) => r.kind === 'membership' && r.id !== excludeId && r.data.decision === 'adopted' && !r.data.excluded);
  const intervals = adopted.filter(r => r.data.type === 'interval');
  const conflicts = data.type === 'baseline' ? intervalsExceedingBaseline(data, intervals).map(r => r.id) : [];
  for (const record of adopted) {
    const other = record.data;
    if (independentBaselines && conflictingBaselines(data, other)) conflicts.push(record.id);
    if (data.type === 'interval' && other.type === 'interval' && candidate.original.source !== record.original.source) {
      const overlaps = data.startAt < other.endAt && other.startAt < data.endAt;
      if (overlaps && (data.startAt !== other.startAt || data.endAt !== other.endAt || data.level !== other.level))
        conflicts.push(record.id);
    }
    if (
      data.type === 'interval' &&
      other.type === 'baseline' &&
      dayOf(data.startAt) <= other.asOf &&
      (candidate.original.source === 'platform' || intervalsExceedingBaseline(other, [...intervals, candidate], candidate).includes(candidate))
    )
      conflicts.push(record.id);
    if (inactiveDuringInterval(data, other) || inactiveDuringInterval(other, data)) conflicts.push(record.id);
  }
  return [...new Set(conflicts)];
}

function cycleForNewRecord(profile, records, candidate) {
  if (candidate.type !== 'interval') return profile.cycleId;
  const intervals = records.filter(isAdoptedInterval);
  if (!intervals.length) return candidate.cycleId || profile.cycleId;
  // Touching half-open intervals still form one continuous period.
  const connected = intervals.filter(({ data }) => data.startAt <= candidate.endAt && candidate.startAt <= data.endAt);
  const latest = connected.sort((a, b) => b.data.endAt.localeCompare(a.data.endAt))[0];
  if (latest) return latest.data.cycleId;
  // A pending interval can retain its own cycle unless another segment has since claimed it.
  return intervals.some(r => r.data.cycleId === candidate.cycleId) ? null : candidate.cycleId || null;
}

function isAdoptedInterval(record) {
  return record.kind === 'membership' && record.data.type === 'interval' && record.data.decision === 'adopted' && !record.data.excluded;
}

function intervalCycleOnDate(records, asOf) {
  return summarizeMembership(records.filter(isAdoptedInterval), asOf).cycleId;
}

function updatesCurrentCycle(data, records) {
  if (data.type === 'baseline') return !records.some(isAdoptedInterval);
  return data.type !== 'interval' || !records.some(record => isAdoptedInterval(record) && record.data.endAt > data.endAt);
}

module.exports = {
  summarizeMembership,
  prepareMembership,
  membershipConflicts,
  cycleForNewRecord,
  intervalCycleOnDate,
  updatesCurrentCycle,
  unionIntervals,
};
