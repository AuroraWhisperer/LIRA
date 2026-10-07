'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const { fanFixture, SCOPE, NOW } = require('../helpers/fan-profile-fixture');

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
