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
  assert.equal(f.run('calendar').length, 0, 'milestones more than three days away stay out of the calendar');
  assert.equal(f.run('reminders').find((item) => item.key.endsWith(':500')).actionable, false);
  f.setNow('2026-09-21T04:00:00.000Z');
  const milestone = f.run('calendar').find((item) => item.key.endsWith(':500'));
  assert.equal(milestone.date, '2026-09-24');
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

test('same-day followups carry their own content into reminders and calendar after edits', t => {
  const f = fanFixture(t);
  const p = f.create();
  const a = f.record(p.id, 'followup', { body: '问候考试', reviewDate: '2026-09-18' });
  const b = f.record(p.id, 'followup', { body: '<试听新歌>', reviewDate: '2026-09-18' });
  const key = record => `followup:${record.id}`;
  assert.ok(f.run('reminders').find(item => item.key === key(a)).basis.includes('问候考试'));
  assert.ok(f.run('calendar').find(item => item.key === key(b)).detail.includes('<试听新歌>'));
  f.record(p.id, 'followup', { ...b.data, body: '询问演出' }, { id: b.id, revision: b.revision });
  assert.ok(f.run('reminders').find(item => item.key === key(b)).basis.includes('询问演出'));
  assert.ok(f.run('calendar').find(item => item.key === key(b)).detail.includes('询问演出'));
  f.run('reminder-state', { profileId: p.id, key: key(a), status: 'handled' });
  assert.equal(f.run('calendar').find(item => item.key === key(a)), undefined);
  assert.equal(f.run('calendar').find(item => item.key === key(b)).profileId, p.id);
});

test('a due companion snooze remains actionable after a newer observation passes its threshold', t => {
  const f = fanFixture(t);
  const p = f.create();
  f.service.importGuardRoster(SCOPE, roster(100));
  const key = 'accompany:1234:100';
  f.run('reminder-state', { profileId: p.id, key, status: 'snoozed' });
  f.setNow('2026-09-19T04:00:00Z');
  f.service.importGuardRoster(SCOPE, roster(101, '2026-09-19T04:00:00Z'));
  f.restart();
  const item = f.detail(p.id).reminders.find(item => item.key === key);
  assert.equal(item.actionable, true);
  assert.equal(item.date, '2026-09-18');
  assert.equal(item.predicted, false);
  assert.equal(f.run('reminders').find(item => item.key === key).status, 'snoozed');
  assert.equal(f.run('list').profiles[0].nextReminder.key, key);
  f.run('reminder-state', { profileId: p.id, key, status: 'handled' });
  assert.equal(f.detail(p.id).reminders.find(item => item.key === key).status, 'handled');
});

test('companion milestones enter profile reminders seven days ahead and the calendar three days ahead', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.service.importGuardRoster(SCOPE, roster(92));
  assert.deepEqual(f.run('reminders'), []);
  assert.equal(f.run('list').profiles[0].nextReminder, null);

  f.setNow('2026-09-19T04:00:00.000Z');
  const reminders = f.run('reminders');
  assert.deepEqual(reminders.map((item) => item.key), ['accompany:1234:100']);
  assert.equal(reminders[0].date, '2026-09-26');
  assert.equal(f.run('list').profiles[0].nextReminder.key, reminders[0].key);
  assert.deepEqual(f.run('calendar'), []);

  f.setNow('2026-09-23T04:00:00.000Z');
  assert.equal(f.run('calendar')[0].profileId, p.id);
  assert.equal(f.run('calendar')[0].date, '2026-09-26');
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

test('automatic roster sync pauses pending milestones on departure and recalculates them on return', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.run('configure', { autoCreate: true, autoUpdate: true, accompanyMilestones: [100, 101] });
  f.service.importGuardRoster(SCOPE, roster(100), '2026-09-18');
  const pending = f.run('reminders').find((item) => item.threshold === 101);
  f.run('reminder-state', { profileId: p.id, key: 'accompany:1234:100', status: 'handled' });
  assert.equal(f.run('calendar')[0].date, '2026-09-19');

  f.setNow('2026-09-19T04:00:00.000Z');
  f.service.importGuardRoster(SCOPE, roster(undefined, '2026-09-19T04:00:00.000Z', false), '2026-09-19');
  assert.deepEqual(f.run('calendar'), []);
  assert.equal(f.run('list').profiles[0].nextReminder, null);
  assert.deepEqual(f.run('reminders').map((item) => [item.key, item.group]), [
    ['accompany:1234:100', 'history'],
  ]);
  assert.equal(f.detail(p.id).guardAccompany.days, 100);

  f.setNow('2026-09-21T04:00:00.000Z');
  f.service.importGuardRoster(SCOPE, roster(100, '2026-09-21T04:00:00.000Z'), '2026-09-21');
  const resumed = f.run('reminders').find((item) => item.key === pending.key);
  assert.equal(resumed.date, '2026-09-22');
  assert.equal(resumed.status, 'pending');
  assert.equal(f.run('list').profiles[0].nextReminder.key, pending.key);
  assert.deepEqual(f.run('calendar').map((item) => item.date), ['2026-09-22']);
  assert.equal(f.run('reminders').find((item) => item.key === 'accompany:1234:100').group, 'history');
});

for (const interruption of ['absence', 'room change']) {
  test(`return without a new companion count keeps milestones paused after ${interruption}`, (t) => {
    const f = fanFixture(t);
    const p = f.create();
    f.service.importGuardRoster(SCOPE, roster(96));
    const awayAt = '2026-09-19T04:00:00.000Z';
    f.setNow(awayAt);
    const away = interruption === 'absence' ? roster(undefined, awayAt, false)
      : { ...roster(undefined, awayAt), roomId: '5678', ownerUid: '98' };
    f.service.importGuardRoster(SCOPE, away);
    const reminderDates = () => f.run('reminders').filter(item => item.threshold === 100).map(item => item.date);
    assert.deepEqual(reminderDates(), []);

    const returnedAt = '2026-09-20T04:00:00.000Z';
    f.setNow(returnedAt);
    f.service.importGuardRoster(SCOPE, roster(undefined, returnedAt));
    f.restart();
    assert.equal(f.detail(p.id).currentGuardLevel, 3);
    assert.equal(f.detail(p.id).guardAccompany.days, 96);
    assert.deepEqual(reminderDates(), []);
    assert.deepEqual(f.run('calendar').map(item => item.date), []);

    if (interruption === 'absence') f.consume([fact(97, returnedAt)]);
    else f.service.importGuardRoster(SCOPE, roster(97, returnedAt));
    assert.deepEqual(reminderDates(), ['2026-09-23']);
    assert.deepEqual(f.run('calendar').map(item => item.date), ['2026-09-23']);
  });
}

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
