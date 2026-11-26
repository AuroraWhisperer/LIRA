'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DAY_MS, dayOf, dayStart, dayIndex, addDays } = require('../../src/fans/dates');
const { prepareMembership } = require('../../src/fans/membership');
const { buildReminders } = require('../../src/fans/reminders');
const { membershipMilestoneDates } = require('../../src/fans/membership-milestones');
const { fanFixture } = require('../helpers/fan-profile-fixture');

const NOW = Date.parse('2026-10-23T04:00:00Z');
const PROFILE = { id: 'profile', alias: '观众', milestoneReminders: true };

function interval(id, startAt, endAt) {
  return { id, kind: 'membership', occurredAt: startAt, original: { source: 'manual' }, data: {
    type: 'interval', decision: 'adopted', startAt, endAt, level: 3, cycleId: id, precision: 'timestamp',
  } };
}

// Visit every day as an independent oracle for candidate-date selection.
// A covered day includes its last valid instant, even before midnight.
function dailyMilestones(records, now, daysAhead) {
  const summarize = prepareMembership(records);
  const membership = summarize(now);
  if (membership.status === 'pending' || (membership.totalDays === null && membership.continuousDays === null)) return [];
  const today = dayOf(now);
  const earliest = addDays(today, -7);
  function coveredDate(date) {
    const end = date === today ? now : dayStart(date) + DAY_MS - 1;
    let summary = summarize(end);
    if (summary.continuousAsOf !== date) {
      const lastEnd = records.filter(record => record.data.type === 'interval' && record.data.decision === 'adopted' && !record.data.excluded)
        .map(record => Date.parse(record.data.endAt)).filter(at => at <= end && at > dayStart(date)).sort((a, b) => b - a)[0];
      if (lastEnd) {
        const covered = summarize(lastEnd - 1);
        summary = { ...summary, continuousDays: covered.continuousDays, continuousAsOf: covered.continuousAsOf, cycleId: covered.cycleId };
      }
    }
    return summary;
  }
  let previous = coveredDate(addDays(earliest, -1));
  const seen = new Set();
  const result = [];
  for (let time = dayStart(earliest); time <= dayStart(addDays(today, daysAhead)); time += DAY_MS) {
    const date = dayOf(time);
    const current = coveredDate(date);
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

test('today counts only evidence that has started and retains a milestone after intraday expiry', () => {
  const previous = interval('old', '2026-09-01T00:00:00+08:00', '2026-09-30T00:00:00+08:00');
  const future = interval('future', '2026-10-23T14:00:00+08:00', '2026-10-25T00:00:00+08:00');
  assert.equal(milestones([previous, future], NOW, 7).find(item => item.key === 'total:30').date, '2026-10-24');
  assert.equal(milestones([previous, future], NOW + 3 * 3600000, 7).find(item => item.key === 'total:30').date, '2026-10-23');
  const expiring = interval('active', '2026-09-24T00:00:00+08:00', '2026-10-23T14:00:00+08:00');
  assert.ok(milestones([expiring], NOW, 7).some(item => item.key === 'continuous:active:30'));
  assert.ok(milestones([expiring], NOW + 3 * 3600000, 7).some(item => item.key === 'continuous:active:30'));
  assert.equal(prepareMembership([expiring])(NOW + 3 * 3600000).status, 'expired');
});

test('an evening expiry keeps the same continuous milestone in forecasts, missed reminders and handled history', () => {
  const record = interval('cycle', '2026-10-28T08:00:00+08:00', '2026-11-26T20:00:00+08:00');
  const key = 'continuous:cycle:30';
  const read = (day, states = []) => buildReminders(PROFILE, [record], states, Date.parse(`2026-11-${day}T12:00:00+08:00`));
  assert.equal(read('25').find(item => item.key === key).date, '2026-11-26');
  const reached = read('26').find(item => item.key === key);
  assert.equal(reached.actionable, true);
  assert.equal(read('27').find(item => item.key === key).group, 'missed');
  const state = { ...reached, status: 'handled' };
  assert.equal(read('27', [state]).find(item => item.key === key).revisedBelowThreshold, false);
  const distant = buildReminders(PROFILE, [record], [state], Date.parse('2026-12-20T04:00:00Z'));
  assert.equal(distant.find(item => item.key === key).revisedBelowThreshold, false);
  const other = interval('next-cycle', '2026-12-01T00:00:00+08:00', '2027-01-01T00:00:00+08:00');
  const nextCycle = buildReminders(PROFILE, [record, other], [state], Date.parse('2026-12-02T04:00:00Z'));
  assert.equal(nextCycle.find(item => item.key === key).revisedBelowThreshold, false);
  record.data.startAt = '2026-11-01T08:00:00+08:00';
  assert.equal(read('27', [state]).find(item => item.key === key).revisedBelowThreshold, true);
});

test('two cycles sharing a Beijing date keep independent forecasts and handled history across restart', t => {
  const f = fanFixture(t);
  const p = f.create();
  const exact = (startAt, endAt) => ({ type: 'interval', precision: 'instant', level: 3, startAt, endAt });
  const first = f.record(p.id, 'membership', exact('2026-10-28T08:00:00+08:00', '2026-11-26T20:00:00+08:00'));
  const next = f.record(p.id, 'membership', exact('2026-11-26T21:00:00+08:00', '2026-12-27T00:00:00+08:00'));
  const firstKey = `continuous:${first.data.cycleId}:30`;
  const nextKey = `continuous:${next.data.cycleId}:30`;
  const find = (list, key) => list.find(item => item.key === key);
  f.setNow('2026-11-25T12:00:00+08:00');
  const forecast = find(f.run('reminders'), firstKey);
  assert.equal(forecast.date, '2026-11-26');
  assert.equal(forecast.predicted, true);
  assert.equal(find(f.run('calendar'), firstKey).date, forecast.date);

  f.setNow('2026-11-26T12:00:00+08:00');
  assert.equal(find(f.detail(p.id).reminders, firstKey).actionable, true);
  f.setNow('2026-11-26T20:30:00+08:00');
  assert.equal(f.detail(p.id).membership.status, 'expired');
  assert.equal(find(f.run('reminders'), firstKey).actionable, true);
  f.setNow('2026-11-26T21:00:00+08:00');
  assert.equal(f.detail(p.id).membership.continuousDays, 1);
  assert.equal(find(f.run('reminders'), firstKey).actionable, true);
  f.setNow('2026-11-27T12:00:00+08:00');
  assert.equal(find(f.run('reminders'), firstKey).group, 'missed');
  f.run('reminder-state', { profileId: p.id, key: firstKey, status: 'handled' });
  f.restart();
  assert.equal(find(f.run('reminders'), firstKey).revisedBelowThreshold, false);
  f.setNow('2026-12-25T12:00:00+08:00');
  assert.equal(find(f.run('reminders'), nextKey).actionable, true);
  assert.equal(find(f.run('reminders'), firstKey).revisedBelowThreshold, false);
  f.record(p.id, 'membership', { ...first.data, endAt: '2026-11-26T00:00:00+08:00' },
    { id: first.id, revision: first.revision });
  assert.equal(find(f.run('reminders'), firstKey).revisedBelowThreshold, true);
  assert.equal(find(f.run('reminders'), nextKey).actionable, true);
});

test('a same-date baseline takes effect in the later cycle without replacing the earlier milestone', t => {
  const f = fanFixture(t);
  const p = f.create();
  const exact = (startAt, endAt) => f.record(p.id, 'membership', { type: 'interval', precision: 'instant', level: 3, startAt, endAt });
  const first = exact('2026-10-28T08:00:00+08:00', '2026-11-26T20:00:00+08:00');
  const next = exact('2026-11-26T21:00:00+08:00', '2026-12-03T21:00:00+08:00');
  const base = f.record(p.id, 'membership', { type: 'baseline', asOf: '2026-11-26', continuousDays: 100 });
  assert.equal(base.data.cycleId, next.data.cycleId);
  const firstKey = `continuous:${first.data.cycleId}:30`;
  const nextKey = `continuous:${next.data.cycleId}:100`;
  const read = key => f.detail(p.id).reminders.find(r => r.key === key);
  f.setNow('2026-11-25T12:00:00+08:00');
  assert.equal(read(firstKey).date, '2026-11-26');
  assert.equal(read(nextKey).date, '2026-11-26');
  f.setNow('2026-11-26T12:00:00+08:00');
  assert.equal(f.detail(p.id).membership.continuousDays, 30);
  assert.equal(read(firstKey).actionable, true);
  assert.ok(!read(nextKey)?.actionable);
  f.setNow('2026-11-26T21:00:00+08:00');
  assert.equal(f.detail(p.id).membership.continuousDays, 100);
  assert.equal(read(firstKey).actionable, true);
  assert.equal(read(nextKey).actionable, true);
});

test('only the snoozed continuous cycle returns when its revised crossing is outside the window', () => {
  const records = [
    interval('first', '2026-06-01T00:00:00+08:00', '2026-07-02T00:00:00+08:00'),
    interval('return', '2026-09-15T00:00:00+08:00', '2026-10-16T00:00:00+08:00'),
  ];
  const state = { key: 'continuous:return:30', date: '2026-10-15', status: 'snoozed', until: dayOf(NOW) };
  const due = buildReminders(PROFILE, records, [state], NOW).filter(item => item.actionable);
  assert.deepEqual(due.map(item => [item.key, item.date]), [[state.key, '2026-10-14']]);
});

test('a full year checks milestone candidates instead of every intervening day', () => {
  const records = [interval('cycle', '2026-10-01T00:00:00+08:00', '2027-12-01T00:00:00+08:00')];
  const prepared = prepareMembership(records);
  const dates = [];
  const summarize = Object.assign(at => { dates.push(at); return prepared(at); }, prepared);
  summarize.milestoneAt = (date, now) => { dates.push(date); return prepared.milestoneAt(date, now); };
  const result = buildReminders(PROFILE, records, [], NOW, {}, { summarize });
  assert.equal(result.length, 6);
  assert.equal(dates.length, 7, 'one current state plus two dates for each of three distinct milestone dates');
  assert.equal(new Set(dates).size, dates.length, 'total and continuous milestones share date evaluations');
});

test('historical baseline extensions use ordered intervals without scanning every segment', () => {
  const start = dayStart('2020-01-01');
  let checks = 0;
  const intervals = Array.from({ length: 1000 }, (_, index) => {
    const time = start + index * 2 * DAY_MS;
    return { get start() { checks++; return time; }, end: time + DAY_MS,
      startDay: dayIndex(time), endDay: dayIndex(time) + 1 };
  });
  const baselines = intervals.map((interval, index) => ({ day: interval.startDay,
    record: { data: { asOf: dayOf(start + index * 2 * DAY_MS), totalDays: null, continuousDays: 1 } },
  }));
  const dates = membershipMilestoneDates(intervals, baselines, addDays(dayOf(NOW), -7), addDays(dayOf(NOW), 7), NOW);
  assert.deepEqual(dates, []);
  assert.ok(checks < baselines.length * 50, `baseline extensions checked ${checks} intervals`);
});
