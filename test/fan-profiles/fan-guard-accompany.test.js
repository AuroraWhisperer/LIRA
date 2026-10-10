'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');

function roster(days, observedAt = NOW, members = true) {
  return {
    roomId: '1234', ownerUid: '99', observedAt, skipped: 0,
    members: members ? [{ uid: IDENTITY.value, name: '海边听歌', level: 3, accompanyDays: days }] : [],
  };
}

function fact(days, observedAt = NOW) {
  return {
    id: 'membership:same-purchase', kind: 'membership',
    membership: { type: 'observation', level: 3, observedAt: NOW },
    guardAccompany: { days, observedAt, roomId: '1234', source: 'guard-toast' },
  };
}

test('roster companion observations survive restart and backup without inventing membership duration', (t) => {
  const f = fanFixture(t);
  const profile = f.create({ notes: '私人备注' });
  f.service.importGuardRoster(SCOPE, roster(494));
  f.restart();
  let saved = f.detail(profile.id);
  assert.equal(saved.guardAccompany.days, 494);
  assert.equal(saved.guardAccompany.source, 'guard-roster');
  assert.equal(saved.membership.totalDays, null);
  assert.equal(saved.membership.continuousDays, null);
  assert.equal(saved.membership.expiry, null);
  assert.equal(saved.notes, '私人备注');
  assert.deepEqual(f.run('settings').accompanyMilestones, [100, 365, 500, 1000]);
  assert.equal(f.run('calendar').length, 0, 'milestones more than three days away stay out of the calendar');
  assert.equal(f.run('reminders').find((item) => item.key.endsWith(':500')).actionable, false);
  f.setNow('2026-09-21T04:00:00.000Z');
  const milestone = f.run('calendar').find((item) => item.key.endsWith(':500'));
  assert.equal(milestone.date, '2026-09-24');
  assert.match(milestone.title, /预计/);
  assert.equal(f.run('reminders').find((item) => item.key.endsWith(':500')).actionable, true);
  assert.equal(f.run('calendar').some((item) => item.key.endsWith(':365')), false);
  const backup = f.run('backup');
  f.service.importGuardRoster(SCOPE, roster(495, '2026-09-19T04:00:00.000Z'));
  const plan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...plan, conflicts: 'replace' });
  saved = f.detail(profile.id);
  assert.equal(saved.guardAccompany.days, 494);
  const malformed = structuredClone(backup);
  malformed.profiles[0].guardAccompany.days = -1;
  assert.throws(() => f.run('preview-restore', { backup: malformed }), /陪伴天数/);
});

test('calendar dates appear three Beijing days ahead, follow edits and never create duplicate manual events', (t) => {
  const f = fanFixture(t);
  const p = f.create({ birthday: { monthDay: '10-02', advance: false } });
  const anniversary = f.record(p.id, 'anniversary', { name: '初次见面', date: '2026-10-02' });
  f.record(p.id, 'followup', { body: '记得问候', reviewDate: '2026-10-01' });
  f.record(p.id, 'caution', { body: '复查约定', reviewDate: '2026-10-02' });
  f.setNow('2026-09-28T15:59:59.000Z');
  assert.deepEqual(f.run('calendar').map((item) => item.date), ['2026-10-01']);
  f.setNow('2026-09-28T16:00:00.000Z');
  const events = f.run('calendar');
  assert.equal(events.length, 4);
  assert.equal(new Set(events.map((item) => item.id)).size, 4);
  assert.deepEqual(f.run('calendar'), events);
  assert.ok(events.every((item) => item.readonly));
  const changed = f.run('save-record', {
    profileId: p.id, id: anniversary.id, revision: anniversary.revision,
    data: { ...anniversary.data, date: '2026-10-03' },
  }).record;
  assert.equal(f.run('calendar').some((item) => item.title.includes('初次见面')), false);
  f.setNow('2026-09-29T16:00:00.000Z');
  const shifted = f.run('calendar').find((item) => item.title.includes('初次见面'));
  assert.equal(shifted.id, events.find((item) => item.title.includes('初次见面')).id);
  assert.equal(shifted.date, '2026-10-03');
  f.run('reminder-state', { profileId: p.id, key: shifted.key, status: 'snoozed' });
  assert.equal(f.run('calendar').some((item) => item.id === shifted.id), false);
  f.setNow('2026-10-01T04:00:00.000Z');
  assert.ok(f.run('calendar').some((item) => item.id === shifted.id));
  f.run('reminder-state', { profileId: p.id, key: shifted.key, status: 'handled' });
  assert.equal(f.run('calendar').some((item) => item.id === shifted.id), false);
  f.run('save-record', { profileId: p.id, id: changed.id, revision: changed.revision, data: { ...changed.data, archived: true } });
  const current = f.detail(p.id);
  f.run('save', { id: p.id, revision: current.revision, birthday: null });
  assert.equal(f.run('calendar').some((item) => item.title.includes('生日')), false);
  f.setNow('2026-10-03T04:00:00.000Z');
  assert.equal(f.run('calendar').length, 0);
});

test('same purchase can fill late companion days once, preserving record edits and ignoring older observations', (t) => {
  const f = fanFixture(t);
  const event = fact(99);
  const { guardAccompany, ...purchase } = event;
  f.consume([purchase]);
  const profile = f.run('find', { identity: IDENTITY });
  f.run('save-record', {
    profileId: profile.id, id: profile.records[0].id, revision: profile.records[0].revision,
    data: { ...profile.records[0].data, reason: '手动核对' },
  });
  f.consume([event]);
  f.consume([fact(2, '2026-09-17T04:00:00.000Z')]);
  let detail = f.detail(profile.id);
  assert.equal(detail.guardAccompany.days, 99);
  assert.equal(detail.records.length, 1);
  assert.equal(detail.records[0].data.reason, '手动核对');
  f.consume([fact(100, '2026-09-19T04:00:00.000Z')]);
  f.setNow('2026-09-19T05:00:00.000Z');
  detail = f.detail(profile.id);
  const reminder = detail.reminders.find((item) => item.metric === 'accompany' && item.threshold === 100);
  assert.equal(reminder.date, '2026-09-19');
  assert.equal(reminder.predicted, false);
  f.run('reminder-state', { profileId: profile.id, key: reminder.key, status: 'handled' });
  assert.equal(f.run('calendar').some((item) => item.key === reminder.key), false);
  f.consume([fact(98, '2026-09-19T06:00:00.000Z')]);
  assert.equal(f.detail(profile.id).reminders.find((item) => item.key === reminder.key).revisedBelowThreshold, true);
});

test('stale, inactive, archived and disabled profiles retain observed counts without forecasting', (t) => {
  const f = fanFixture(t);
  const profile = f.create();
  f.service.importGuardRoster(SCOPE, roster(99));
  f.setNow('2026-09-26T04:00:00.000Z');
  assert.equal(f.detail(profile.id).guardAccompany.days, 99);
  assert.equal(f.detail(profile.id).guardAccompany.stale, true);
  assert.equal(f.run('calendar').length, 0);
  f.setNow(NOW);
  f.service.importGuardRoster(SCOPE, roster(undefined, '2026-09-18T05:00:00.000Z', false));
  assert.equal(f.detail(profile.id).guardAccompany.inactive, true);
  assert.equal(f.run('calendar').length, 0);
  f.service.importGuardRoster(SCOPE, roster(99, '2026-09-18T06:00:00.000Z'));
  for (const patch of [{ archived: true }, { archived: false, milestoneReminders: false }]) {
    const current = f.detail(profile.id);
    f.run('save', { id: profile.id, revision: current.revision, ...patch });
    assert.equal(f.run('calendar').length, 0);
  }
});

test('settings and scope govern calendar projections, with Beijing dates and no projection stored in backups', (t) => {
  const f = fanFixture(t);
  f.service.importGuardRoster(SCOPE, roster(499, '2026-09-17T16:01:00.000Z'));
  f.run('configure', { autoCreate: true, autoUpdate: true, accompanyMilestones: [500] });
  assert.equal(f.run('calendar')[0].date, '2026-09-19');
  assert.equal(f.run('calendar', {}, JSON.stringify(['https://other.example', 'streamer-a'])).length, 0);
  const backup = f.run('backup');
  assert.equal(Object.hasOwn(backup, 'events'), false);
  f.run('configure', { autoCreate: true, autoUpdate: true, showAccompanyInCalendar: false });
  assert.equal(f.run('calendar').length, 0);
  assert.equal(f.run('reminders').filter((item) => item.metric === 'accompany').length, 1);
  const plan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...plan, conflicts: 'keep' });
  assert.equal(f.run('calendar').length, 1);
  for (const accompanyMilestones of [[NaN], [-1], [1.5], [100001], Array(11).fill(100)]) {
    assert.throws(() => f.run('configure', { autoCreate: true, autoUpdate: true, accompanyMilestones }), /陪伴纪念日/);
  }
});

test('invalid roster observation rolls back and changing a bound identity clears its companion snapshot', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.service.importGuardRoster(SCOPE, roster(0));
  assert.equal(f.detail(p.id).guardAccompany.days, 0);
  assert.throws(() => f.service.importGuardRoster(SCOPE, roster('100')), /陪伴天数/);
  const prior = f.detail(p.id);
  const saved = f.run('save', { id: p.id, revision: prior.revision, identity: { ...IDENTITY, value: '42' } });
  assert.equal(saved.guardAccompany, null);
});
