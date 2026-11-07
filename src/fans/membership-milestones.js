'use strict';

const { DAY_MS, dayIndex, dayStart, dayOf } = require('./dates');

const MEMBERSHIP_MILESTONES = [30, 100, 365];

// Locate an ordinal covered day without visiting the calendar days in between.
function coveredDay(intervals, after, remaining) {
  let previousEnd = after + 1;
  for (const interval of intervals) {
    const start = Math.max(interval.startDay, previousEnd);
    const count = Math.max(0, interval.endDay - start);
    if (remaining <= count) return start + remaining - 1;
    remaining -= count;
    previousEnd = Math.max(previousEnd, interval.endDay);
  }
  return null;
}

// prepareMembership supplies disjoint intervals ordered by start.
function intervalAt(intervals, at) {
  let low = 0;
  let high = intervals.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const interval = intervals[middle];
    if (interval.start > at) high = middle - 1;
    else if (interval.end <= at) low = middle + 1;
    else return interval;
  }
  return null;
}

function membershipMilestoneDates(intervals, baselines, earliest, latest, now) {
  const firstTime = dayStart(earliest);
  const firstDay = dayIndex(firstTime);
  const lastDay = dayIndex(dayStart(latest));
  const today = dayIndex(now);
  const days = new Set();
  function add(day) {
    if (day === null || day < firstDay || day > lastDay) return;
    days.add(day);
    // Today's evidence is evaluated at now, not at the end of the day. A
    // not-yet-started interval can move today's predicted crossing to tomorrow.
    if (day === today && day < lastDay) days.add(day + 1);
  }
  for (const threshold of MEMBERSHIP_MILESTONES) {
    add(coveredDay(intervals, -Infinity, threshold));
    for (const interval of intervals) {
      const day = interval.startDay + threshold - 1;
      if (day < interval.endDay) add(day);
    }
    for (const { record, day } of baselines) {
      const { totalDays, continuousDays } = record.data;
      if (totalDays !== null && totalDays <= threshold) {
        add(totalDays === threshold ? day : coveredDay(intervals, day, threshold - totalDays));
      }
      if (continuousDays === null || continuousDays > threshold) continue;
      if (continuousDays === threshold) {
        add(day);
        continue;
      }
      const extensionStart = dayStart(record.data.asOf) + DAY_MS;
      const extension = intervalAt(intervals, extensionStart);
      const candidate = day + threshold - continuousDays;
      if (extension && candidate < extension.endDay) add(candidate);
    }
  }
  return [...days].sort((a, b) => a - b).map(day => dayOf(firstTime + (day - firstDay) * DAY_MS));
}

module.exports = { MEMBERSHIP_MILESTONES, membershipMilestoneDates };
