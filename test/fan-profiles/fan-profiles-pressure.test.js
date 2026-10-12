'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const { fanFixture, SCOPE, NOW } = require('../helpers/fan-profile-fixture');
const { recordData } = require('../../src/fans/validation');

test('500 confirmed memberships project milestones for list, reminders and calendar', (t) => {
  const f = fanFixture(t);
  f.setNow('2026-09-28T04:00:00.000Z');
  f.store.transaction(() => {
    for (let index = 0; index < 500; index += 1) {
      const profile = f.store.save(SCOPE, {
        alias: `观众-${index}`, tags: [], archived: false, milestoneReminders: true, cycleId: `cycle-${index}`,
      }, null, NOW);
      const data = recordData('membership', {
        type: 'interval', precision: 'date', level: 3, start: '2026-09-01', end: '2027-10-01',
      });
      data.cycleId = profile.cycleId;
      f.store.records.insert(SCOPE, profile.id, { kind: 'membership', data, occurredAt: NOW });
    }
  });
  const measurements = {};
  for (const action of ['list', 'reminders', 'calendar']) {
    const started = performance.now();
    const result = f.run(action);
    measurements[action] = Math.round(performance.now() - started);
    if (action === 'list') {
      assert.equal(result.profiles.length, 500);
      assert.ok(result.profiles.every((p) => p.nextReminder.date === '2026-09-30'));
    } else {
      assert.equal(result.length, 1000);
      assert.ok(result.every((item) => item.date === '2026-09-30'));
      if (action === 'reminders') assert.ok(result.every((item) => item.threshold === 30));
    }
  }
  t.diagnostic(JSON.stringify({ profiles: 500, confirmedIntervals: 500, elapsedMs: measurements }));
});

test('1000 fan facts preserve full history across replay, a failed page and restart', (t) => {
  const f = fanFixture(t);
  const events = Array.from({ length: 1000 }, (_, index) => ({
    id: `pressure-membership-${index}`,
    identity: { platform: 'bilibili', type: 'uid', value: String(900000001 + (index % 100)) },
    name: 'Same display name',
    kind: 'membership',
    membership: { type: 'observation', level: 3, observedAt: NOW },
  }));
  const started = performance.now();
  for (let index = 0; index < events.length; index += 200) f.consume(events.slice(index, index + 200));
  const profiles = f.store.list(SCOPE);
  assert.equal(profiles.length, 100);
  assert.equal(f.run('settings').cursor, 1000);
  for (const profile of profiles) assert.equal(f.detail(profile.id).records.length, 10);

  for (let index = 0; index < events.length; index += 200) {
    const replay = events.slice(index, index + 200).map((event, offset) => ({ ...event, cursor: index + offset + 1 }));
    f.consume(replay, index === 0 ? { reset: true, after: 0, nextCursor: 200 } : {});
  }
  const revisions = profiles.map((profile) => f.detail(profile.id).revision);
  const latePage = Array.from({ length: 200 }, (_, index) => ({
    ...events[index],
    id: `later-${index}`,
    name: 'This page must roll back',
    observedAt: '2026-09-19T04:00:00.000Z',
  }));
  latePage[199].membership = { type: 'interval', level: 3, start: '2026-09-01', end: '2026-09-30' };
  assert.throws(() => f.consume(latePage), /已核实证据/);
  assert.equal(f.run('settings').cursor, 1000);
  assert.deepEqual(
    profiles.map((profile) => f.detail(profile.id).revision),
    revisions,
  );
  f.restart();
  for (const profile of profiles) {
    const actual = f.detail(profile.id);
    assert.equal(actual.records.length, 10, 'replays and an aborted page add no history');
    assert.equal(actual.platformName, 'Same display name');
    assert.equal(new Set(actual.records.map((record) => record.sourceKey)).size, 10);
  }
  assert.equal(f.run('settings').cursor, 1000);
  t.diagnostic(
    JSON.stringify({
      scenario: 'fan-facts',
      facts: 1000,
      replays: 1000,
      users: 100,
      rejectedPage: 200,
      retainedRecords: 1000,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
    }),
  );
});
