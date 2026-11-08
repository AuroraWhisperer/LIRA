'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { prepareMembership } = require('../../src/fans/membership');

function fixture() {
  const counts = { preparations: 0, summaries: 0 };
  const filename = require.resolve('../../src/fans/profile-projection');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module'], { filename })(name => {
    if (name !== './membership') return localRequire(name);
    return { prepareMembership(records) {
      counts.preparations++;
      const raw = prepareMembership(records);
      return Object.assign(at => { counts.summaries++; return raw(at); }, raw);
    } };
  }, module);
  const project = module.exports.createFanProfileProjection();
  const at = Date.parse('2026-10-23T04:00:00Z');
  const profile = { id: 'person', alias: '观众', birthday: { calendar: 'solar', monthDay: '10-24' } };
  const record = { id: 'interval', kind: 'membership', occurredAt: '2026-10-01T00:00:00Z',
    original: { source: 'manual' }, data: { type: 'interval', decision: 'adopted', level: 3,
      startAt: '2026-10-01T00:00:00+08:00', endAt: '2027-12-01T00:00:00+08:00', cycleId: 'cycle', precision: 'date' } };
  return { counts, project, profile, record, at,
    read: (overrides = {}) => project(overrides.scope || 'account-a', overrides.profile || profile,
      overrides.records || [record], overrides.states || [], overrides.at ?? at, overrides.settings || {}, overrides.daysAhead),
  };
}

test('full scans of 1001 profiles reuse reminders, calculate only changes and extend detail on demand', () => {
  const f = fixture();
  const profiles = Array.from({ length: 1001 }, (_, id) => ({ ...f.profile, id: `person-${id}` }));
  for (const profile of profiles) f.read({ profile });
  assert.deepEqual(f.counts, { preparations: 1001, summaries: 3003 });
  for (const profile of profiles) f.read({ profile, at: f.at + 30000 });
  assert.deepEqual(f.counts, { preparations: 1001, summaries: 3003 });
  profiles[0] = { ...profiles[0], birthday: { calendar: 'solar', monthDay: '10-26' } };
  for (const profile of profiles) f.read({ profile });
  assert.deepEqual(f.counts, { preparations: 1002, summaries: 3006 });
  f.read({ profile: profiles[0], daysAhead: 366 });
  assert.equal(f.counts.preparations, 1002);
  assert.equal(f.counts.summaries, 3010, 'detail reuses near dates and adds only the two distant milestone pairs');
});

test('full inventories and deletions release removed profiles, and account switches release the old working set', () => {
  const f = fixture();
  const removed = { ...f.profile, id: 'removed' };
  f.read();
  f.read({ profile: removed });
  f.project.retain('account-a', [f.profile]);
  f.read();
  assert.equal(f.counts.preparations, 2, 'retained profiles remain warm');
  f.read({ profile: removed });
  assert.equal(f.counts.preparations, 3, 'restoring a removed ID starts a fresh projection');
  f.project.drop('account-a', removed.id);
  f.read({ profile: removed });
  assert.equal(f.counts.preparations, 4, 'single deletions also release their projection');
  f.read({ scope: 'account-b' });
  f.read();
  assert.equal(f.counts.preparations, 6, 'returning to an account rebuilds its released working set');
});

test('cached projections isolate accounts, returned objects, reminder state and restore with reused revisions', () => {
  const f = fixture();
  const initial = f.read();
  initial.membership.totalDays = -1;
  initial.reminders[0].title = 'corrupted';
  assert.equal(f.read().membership.totalDays, 23);
  assert.ok(f.read().reminders.every(item => item.title !== 'corrupted'));
  const states = [{ key: 'birthday:2026', status: 'handled' }];
  assert.equal(f.read({ states }).reminders.find(item => item.key === 'birthday:2026').status, 'handled');
  const before = f.counts.preparations;
  f.read({ states, scope: 'account-b' });
  assert.equal(f.counts.preparations, before + 1);
  const changed = structuredClone(f.record);
  changed.data.startAt = '2026-10-02T00:00:00+08:00';
  assert.equal(f.read({ records: [changed] }).membership.totalDays, 22);
  assert.equal(f.read().membership.totalDays, 23, 'rollback restores the original inputs even without changing revisions');
});

test('midnight, precise start/expiry, observations and clock rollback invalidate at their boundaries', () => {
  const f = fixture();
  const record = structuredClone(f.record);
  record.data.startAt = '2026-10-23T14:00:00+08:00';
  record.data.endAt = '2026-10-23T16:00:00+08:00';
  assert.equal(f.read({ records: [record] }).membership.status, 'unknown');
  const startAt = Date.parse(record.data.startAt);
  assert.equal(f.read({ records: [record], at: startAt - 1 }).membership.status, 'unknown');
  assert.equal(f.counts.preparations, 1);
  assert.equal(f.read({ records: [record], at: startAt }).membership.status, 'active');
  const endAt = Date.parse(record.data.endAt);
  assert.equal(f.read({ records: [record], at: endAt }).membership.status, 'expired');
  assert.equal(f.read({ records: [record], at: startAt }).membership.status, 'active', 'clock rollback recalculates');
  const observation = { id: 'observation', kind: 'membership', original: { source: 'platform' },
    data: { type: 'observation', decision: 'adopted', observedAt: '2026-10-23T18:00:00+08:00', level: 2 } };
  assert.equal(f.read({ records: [record, observation], at: endAt }).membership.status, 'expired');
  assert.equal(f.read({ records: [record, observation], at: Date.parse(observation.data.observedAt) }).membership.status, 'unknown');
  assert.equal(f.read().membership.totalDays, 23);
  assert.equal(f.read({ at: Date.parse('2026-10-24T00:00:00+08:00') }).membership.totalDays, 24);
});

test('reminder inputs invalidate while identity observations, unrelated records and sync cursors do not', () => {
  const f = fixture();
  f.profile.guardAccompany = { roomId: '123', days: 98, observedAt: '2026-10-23T04:00:00Z', source: 'guard-roster' };
  f.read({ settings: { accompanyMilestones: [100] } });
  const before = f.counts.preparations;
  f.read({ profile: { ...f.profile, revision: 2, platformObservedAt: '2026-10-23T04:00:15Z',
    lastObservedAt: '2026-10-23T04:00:15Z', updatedAt: '2026-10-23T04:00:15Z', avatar: 'new-avatar' },
    records: [f.record, { kind: 'note', data: { body: 'unrelated' } }],
    settings: { accompanyMilestones: [100], cursor: 999 } });
  assert.equal(f.counts.preparations, before);
  const changed = f.read({ settings: { accompanyMilestones: [101] } });
  assert.equal(f.counts.preparations, before + 1);
  assert.ok(changed.reminders.some(item => item.metric === 'accompany' && item.threshold === 101));
  const renamed = f.read({ profile: { ...f.profile, alias: '新称呼' }, settings: { accompanyMilestones: [101] } });
  assert.equal(f.counts.preparations, before + 2);
  assert.ok(renamed.reminders.every(item => item.name === '新称呼'));
});
