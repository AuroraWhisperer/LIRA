'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DAY_MS, dayOf, dayStart, addDays } = require('../../src/fans/dates');
const { prepareMembership } = require('../../src/fans/membership');
const { buildReminders } = require('../../src/fans/reminders');

const NOW = Date.parse('2026-10-23T04:00:00Z');
const PROFILE = { id: 'profile', alias: '观众', milestoneReminders: true };

function interval(id, startAt, endAt) {
  return { id, kind: 'membership', occurredAt: startAt, original: { source: 'manual' }, data: {
    type: 'interval', decision: 'adopted', startAt, endAt, level: 3, cycleId: id, precision: 'timestamp',
  } };
}

// The previous daily rule is an independent oracle for the candidate-date
// algorithm, including downward baselines and current-day partial evidence.
function dailyMilestones(records, now, daysAhead) {
  const summarize = prepareMembership(records);
  const membership = summarize(now);
  if (membership.status === 'pending' || (membership.totalDays === null && membership.continuousDays === null)) return [];
  const today = dayOf(now);
  const earliest = addDays(today, -7);
  let previous = summarize(addDays(earliest, -1));
  const seen = new Set();
  const result = [];
  for (let time = dayStart(earliest); time <= dayStart(addDays(today, daysAhead)); time += DAY_MS) {
    const date = dayOf(time);
    const current = date === today ? membership : summarize(time + DAY_MS - 1);
    for (const metric of ['total', 'continuous']) {
      for (const threshold of [30, 100, 365]) {
        const value = current[`${metric}Days`];
        const prior = previous[`${metric}Days`];
        const baseline = records.some(record => record.data.type === 'baseline'
          && record.data.decision === 'adopted' && record.data.asOf === date && record.data[`${metric}Days`] !== null);
        if (baseline && value > threshold) continue;
        if (value === null || value < threshold || (prior !== null && prior >= threshold)) continue;
        if (metric === 'continuous' && current.continuousAsOf !== date) continue;
        const key = metric === 'total' ? `total:${threshold}` : `continuous:${current.cycleId}:${threshold}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ key, date, metric, threshold });
      }
    }
    previous = current;
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

function milestones(records, now, daysAhead) {
  return buildReminders(PROFILE, records, [], now, {}, { daysAhead })
    .map(({ key, date, metric, threshold }) => ({ key, date, metric, threshold }));
}

test('candidate dates match daily rules across overlapping intervals, baselines and prediction windows', () => {
  let seed = 2351;
  const random = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
  const start = dayStart(dayOf(NOW));
  for (let sample = 0; sample < 300; sample++) {
    const records = [];
    for (let index = 0; index < 1 + random(8); index++) {
      const from = start + (random(180) - 120) * DAY_MS + random(24) * 3600000;
      const end = from + (1 + random(220)) * DAY_MS + random(24) * 3600000;
      const record = interval(`i-${index}`, new Date(from).toISOString(), new Date(end).toISOString());
      record.data.excluded = random(9) === 0;
      records.push(record);
    }
    for (let index = 0; index < random(6); index++) {
      records.push({ id: `b-${index}`, kind: 'membership', occurredAt: new Date(NOW + index).toISOString(),
        original: { source: 'manual' }, data: {
          type: 'baseline', decision: 'adopted', excluded: random(9) === 0,
          asOf: dayOf(start + (random(160) - 100) * DAY_MS),
          totalDays: random(4) === 0 ? null : random(140),
          continuousDays: random(4) === 0 ? null : random(140), cycleId: `b-${index}`,
        } });
    }
    const daysAhead = [3, 7, 366][sample % 3];
    assert.deepEqual(milestones(records, NOW, daysAhead), dailyMilestones(records, NOW, daysAhead), `sample ${sample}`);
  }
});

test('today counts only evidence that has started and preserves intraday expiry', () => {
  const previous = interval('old', '2026-09-01T00:00:00+08:00', '2026-09-30T00:00:00+08:00');
  const future = interval('future', '2026-10-23T14:00:00+08:00', '2026-10-25T00:00:00+08:00');
  assert.equal(milestones([previous, future], NOW, 7).find(item => item.key === 'total:30').date, '2026-10-24');
  assert.equal(milestones([previous, future], NOW + 3 * 3600000, 7).find(item => item.key === 'total:30').date, '2026-10-23');
  const expiring = interval('active', '2026-09-24T00:00:00+08:00', '2026-10-23T14:00:00+08:00');
  assert.ok(milestones([expiring], NOW, 7).some(item => item.key === 'continuous:active:30'));
  assert.ok(!milestones([expiring], NOW + 3 * 3600000, 7).some(item => item.key === 'continuous:active:30'));
});

test('a full year checks milestone candidates instead of every intervening day', () => {
  const records = [interval('cycle', '2026-10-01T00:00:00+08:00', '2027-12-01T00:00:00+08:00')];
  const prepared = prepareMembership(records);
  const dates = [];
  const summarize = Object.assign(at => { dates.push(at); return prepared(at); }, prepared);
  const result = buildReminders(PROFILE, records, [], NOW, {}, { summarize });
  assert.equal(result.length, 6);
  assert.equal(dates.length, 7, 'one current state plus two dates for each of three distinct milestone dates');
  assert.equal(new Set(dates).size, dates.length, 'total and continuous milestones share date evaluations');
});
