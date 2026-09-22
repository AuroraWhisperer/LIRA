'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

test('former names keep the latest three distinct names, support edits and survive restart and restore', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const observe = (name, day) => f.consume([{ name, observedAt: `2026-09-${day}T04:00:00Z` }]);
  for (const [index, name] of ['a', 'b', 'c', 'd', 'e', 'e'].entries()) observe(name, 10 + index);
  assert.deepEqual(f.detail(p.id).formerNames, ['d', 'c', 'b']);
  observe('c', 16);
  assert.deepEqual(f.detail(p.id).formerNames, ['e', 'd', 'b']);
  observe('stale', 11);
  assert.equal(f.detail(p.id).platformName, 'c');
  const before = f.detail(p.id);
  const saved = f.run('save', { id: p.id, revision: before.revision, formerNames: ['手动昵称', 'c', '手动昵称'] });
  assert.deepEqual(saved.formerNames, ['手动昵称']);
  assert.equal(f.run('list', { query: '手动昵称' }).profiles[0].id, p.id);
  observe('f', 17);
  assert.deepEqual(f.detail(p.id).formerNames, ['c', '手动昵称']);
  assert.equal(f.detail(p.id).alias, '小海');
  f.restart();
  assert.deepEqual(f.detail(p.id).formerNames, ['c', '手动昵称']);
  const backup = f.run('backup');
  const current = f.detail(p.id);
  f.run('save', { id: p.id, revision: current.revision, formerNames: [] });
  assert.deepEqual(f.detail(p.id).formerNames, []);
  const preview = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...preview, conflicts: 'replace' });
  assert.deepEqual(f.detail(p.id).formerNames, ['c', '手动昵称']);
  const revision = f.detail(p.id).revision;
  for (const formerNames of [['a', 'b', 'c', 'd'], [123], ['x'.repeat(201)], 'wrong']) {
    assert.throws(() => f.run('save', { id: p.id, revision, formerNames }), /曾用名/);
  }
  assert.equal(f.detail(p.id).revision, revision);
});

test('old backups with long name history retain compatibility and project only recent distinct names', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const backup = f.run('backup');
  backup.profiles[0].platformName = 'e';
  backup.profiles[0].nameHistory = ['a', 'b', 'c', 'b', 'd', 'e'].map((name) => ({ name, observedAt: NOW }));
  const preview = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...preview, conflicts: 'replace' });
  assert.deepEqual(f.detail(p.id).formerNames, ['d', 'b', 'c']);
  assert.equal(f.detail(p.id).nameHistory.length, 6);
});

test('a new baseline does not invent dates for smaller historical milestones', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', interval('2026-09-01', '2026-09-30'));
  f.record(p.id, 'membership', { type: 'baseline', asOf: '2026-09-18', totalDays: 120, continuousDays: 95 });
  const reminders = f.detail(p.id).reminders.filter((r) => r.metric);
  assert.equal(
    reminders.some((r) => r.date === '2026-09-18'),
    false,
  );
  assert.ok(reminders.some((r) => r.metric === 'continuous' && r.threshold === 100 && r.date === '2026-09-23'));
});

test('A01-A03: complete newer names preserve private fields and reject stale or truncated observations', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '只在本地保存', tags: ['吉他'], birthday: { monthDay: '09-19' } });
  f.consume([{ name: '旧昵称', observedAt: '2026-09-17T04:00:00Z' }]);
  f.consume([{ name: '新昵称' }]);
  f.consume([{ name: '迟到旧昵称', observedAt: '2026-09-16T04:00:00Z' }]);
  for (const name of ['观众', '用户', '新…', '新***', '新...']) {
    f.service.observeIdentity(SCOPE, {
      identity: IDENTITY,
      name,
      nameComplete: false,
      observedAt: '2026-09-19T04:00:00Z',
    });
  }
  const actual = f.detail(p.id);
  assert.equal(actual.platformName, '新昵称');
  assert.equal(actual.alias, '小海');
  assert.equal(actual.notes, '只在本地保存');
  assert.deepEqual(actual.tags, ['吉他']);
  assert.equal(actual.birthday.monthDay, '09-19');
  assert.deepEqual(
    actual.nameHistory.map((item) => item.name),
    ['旧昵称'],
  );
  assert.equal(actual.records.length, 0, 'identity observations do not flood interaction history');
});

test('A02/A03/A15: identical nicknames and UID-shaped open IDs never merge or bind drafts', (t) => {
  const f = fanFixture(t);
  const uid = f.create();
  const openId = f.create({ identity: { ...IDENTITY, type: 'open_id' } });
  const second = f.create({ identity: { ...IDENTITY, value: '900000002' } });
  const draft = f.create({ identity: null });
  for (const identity of [IDENTITY, { ...IDENTITY, type: 'open_id' }, { ...IDENTITY, value: '900000002' }]) {
    f.consume([{ identity, name: '同一个昵称' }]);
  }
  assert.equal(new Set([uid.id, openId.id, second.id, draft.id]).size, 4);
  assert.equal(f.detail(draft.id).identity, null);
  assert.equal(f.detail(draft.id).platformName, '');
  assert.equal(f.run('find', { identity: IDENTITY }).id, uid.id);
  assert.equal(f.run('find', { identity: { ...IDENTITY, type: 'open_id' } }).id, openId.id);
  assert.equal(f.run('list', { query: '同一个昵称' }).profiles.length, 3);
  assert.throws(() => f.run('save', { id: draft.id, revision: draft.revision, identity: IDENTITY }), /已有档案/);
});

test('A14: profile CRUD and remote facts remain isolated by server and streamer', (t) => {
  const f = fanFixture(t);
  const secondScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  const otherServer = JSON.stringify(['https://other.example', 'streamer-a']);
  const a = f.create({ notes: '甲的备注' });
  const b = f.create({ notes: '乙的备注' }, secondScope);
  const c = f.create({ notes: '另一个服务器' }, otherServer);
  assert.equal(f.run('find', { identity: IDENTITY }, secondScope).id, b.id);
  assert.equal(f.run('find', { identity: IDENTITY }, otherServer).id, c.id);
  assert.throws(() => f.detail(a.id, secondScope), /不属于当前账号/);
  assert.throws(() => f.run('save', { id: a.id, revision: a.revision, notes: '越界' }, secondScope), /不属于当前账号/);
  assert.throws(
    () => f.consume([{ name: '迟到的甲账号事件' }], { streamerId: 'streamer-a' }, secondScope),
    /账号不匹配/,
  );
  assert.equal(f.detail(b.id, secondScope).notes, '乙的备注');
  assert.equal(f.detail(b.id, secondScope).platformName, '');
});

test('remote fact page and cursor roll back atomically on invalid evidence and survive replay', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  assert.throws(
    () =>
      f.consume([{ name: '不得提前保存' }, { kind: 'membership', membership: interval('2026-09-01', '2026-09-30') }]),
    /缺少已核实证据/,
  );
  assert.equal(f.detail(p.id).platformName, '');
  assert.equal(f.detail(p.id).records.length, 0);
  assert.equal(f.run('settings').cursor, 0);
  const membership = { type: 'observation', level: 3, observedAt: NOW };
  f.consume([{ id: 'same-membership', kind: 'membership', membership }]);
  f.consume([{ id: 'same-membership', kind: 'membership', membership }]);
  assert.equal(f.detail(p.id).records.length, 1);
  assert.equal(f.run('settings').cursor, 2);
  f.restart();
  assert.equal(f.run('settings').cursor, 2);
  assert.equal(f.detail(p.id).records.length, 1);
});

test('A09: an old guard observation neither proves active status nor an expiry date', (t) => {
  const f = fanFixture(t);
  f.consume([
    {
      kind: 'membership',
      observedAt: '2026-06-18T04:00:00Z',
      membership: { type: 'observation', level: 3, observedAt: '2026-06-18T04:00:00Z' },
    },
  ]);
  const p = f.run('find', { identity: IDENTITY });
  assert.equal(p.membership.status, 'unknown');
  assert.equal(p.membership.observedAt, '2026-06-18T04:00:00.000Z');
  assert.equal(p.membership.expiry, null);
  assert.equal(p.membership.totalDays, null);
  assert.equal(f.run('list', { filters: ['active'] }).profiles.length, 0);
  assert.equal(f.run('list', { filters: ['unknown'] }).profiles.length, 1);
  assert.equal(p.reminders.length, 0);
});

test('A21: confirmed future validity counts only elapsed Shanghai days and predicts future milestones', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', interval('2026-09-01', '2026-12-31'));
  const actual = f.detail(p.id);
  assert.equal(actual.membership.totalDays, 18);
  assert.equal(actual.membership.continuousDays, 18);
  assert.equal(actual.membership.status, 'active');
  assert.equal(actual.membership.expiry.date, '2026-12-31');
  const hundred = actual.reminders.find((item) => item.key === 'total:100');
  assert.equal(hundred.date, '2026-12-09');
  assert.equal(hundred.predicted, true);
  assert.equal(hundred.actionable, false);
});

test('A10: interval union deduplicates overlap, retains lower ranks, and resets after confirmed gap', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', interval('2026-09-01', '2026-09-30'));
  f.record(p.id, 'membership', interval('2026-09-10', '2026-09-20', { level: 1 }));
  const firstCycle = f.detail(p.id).membership.cycleId;
  assert.equal(f.detail(p.id).membership.totalDays, 18);
  assert.equal(f.detail(p.id).membership.level, 1);
  f.setNow('2026-09-21T04:00:00Z');
  assert.equal(f.detail(p.id).membership.level, 3);
  f.record(p.id, 'membership', interval('2026-10-01', '2026-10-31'));
  f.setNow('2026-10-10T04:00:00Z');
  assert.equal(f.detail(p.id).membership.continuousDays, 40);
  assert.equal(f.detail(p.id).membership.cycleId, firstCycle);
  f.record(p.id, 'membership', interval('2026-11-05', '2026-12-31'));
  f.setNow('2026-11-05T04:00:00Z');
  assert.equal(f.detail(p.id).membership.continuousDays, 1);
  assert.equal(f.detail(p.id).membership.totalDays, 62);
  assert.notEqual(f.detail(p.id).membership.cycleId, firstCycle);
});

test('half-open exact validity excludes future starts and end instants, counting each business day once', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', {
    type: 'interval',
    precision: 'instant',
    level: 3,
    startAt: '2026-09-18T12:00:00+08:00',
    endAt: '2026-09-19T00:00:00+08:00',
  });
  f.setNow('2026-09-18T11:59:59+08:00');
  assert.equal(f.detail(p.id).membership.totalDays, 0);
  assert.equal(f.detail(p.id).membership.status, 'unknown');
  f.setNow('2026-09-18T12:00:00+08:00');
  assert.equal(f.detail(p.id).membership.totalDays, 1);
  assert.equal(f.detail(p.id).membership.status, 'active');
  f.setNow('2026-09-19T00:00:00+08:00');
  assert.equal(f.detail(p.id).membership.totalDays, 1);
  assert.equal(f.detail(p.id).membership.status, 'expired');
});

test('A08/A24: a total baseline does not invent continuous days or double-count old intervals', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', { type: 'baseline', totalDays: 120, asOf: '2026-09-18' });
  assert.equal(f.detail(p.id).membership.totalDays, 120);
  assert.equal(f.detail(p.id).membership.continuousDays, null);
  f.record(p.id, 'membership', interval('2026-05-01', '2026-05-31'));
  assert.equal(f.detail(p.id).membership.totalDays, 120);
  f.record(p.id, 'membership', interval('2026-09-19', '2026-09-20'));
  f.setNow('2026-09-19T04:00:00Z');
  assert.equal(f.detail(p.id).membership.totalDays, 121);
  f.setNow('2026-10-01T04:00:00Z');
  assert.equal(f.detail(p.id).membership.totalDays, 122);
});

test('A24: baseline validation rejects negative, fractional, missing-date and impossible counts', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  for (const data of [
    { totalDays: -1, asOf: '2026-09-18' },
    { continuousDays: 1.5, asOf: '2026-09-18' },
    { totalDays: 120 },
    { totalDays: 90, continuousDays: 100, asOf: '2026-09-18' },
  ])
    assert.throws(() => f.record(p.id, 'membership', { type: 'baseline', ...data }));
  assert.equal(f.detail(p.id).records.length, 0);
});

test('A11: conflicting platform expiry is pending, pauses membership reminders, and replay cannot reopen resolution', (t) => {
  const f = fanFixture(t);
  const p = f.create({ expiryReminders: true, birthday: { monthDay: '09-18' } });
  const manual = f.record(p.id, 'membership', interval('2026-09-01', '2026-12-31'));
  const event = {
    id: 'conflicting-expiry',
    kind: 'membership',
    membership: interval('2026-09-01', '2026-11-30', { evidenceVerified: true }),
  };
  f.consume([event]);
  let actual = f.detail(p.id);
  assert.equal(actual.membership.status, 'pending');
  assert.equal(actual.membership.expiry.recordId, manual.id);
  assert.equal(actual.reminders.filter((item) => /^(expiry|total|continuous):/.test(item.key)).length, 0);
  assert.equal(actual.reminders.find((item) => item.key === 'birthday:2026').actionable, true);
  const pending = actual.records.find((record) => record.data.decision === 'pending');
  f.run('resolve-membership', { profileId: p.id, id: pending.id, choice: 'adopt' });
  f.consume([event]);
  actual = f.detail(p.id);
  assert.equal(actual.membership.status, 'active');
  assert.equal(actual.membership.expiry.date, '2026-11-30');
  assert.equal(actual.membership.pending.length, 0);
  assert.equal(actual.records.length, 2);
  assert.equal(actual.records.find((r) => r.id === manual.id).data.decision, 'superseded');
});

test('A12/A28: yearless leap-day birthdays use chosen solar rules and lunar dates need conversion', (t) => {
  const f = fanFixture(t);
  f.setNow('2027-02-28T04:00:00Z');
  let p = f.create({ birthday: { monthDay: '02-29' } });
  assert.equal(p.birthday.year, null);
  assert.equal(p.reminders.find((r) => r.key === 'birthday:2027').date, '2027-02-28');
  p = f.run('save', { id: p.id, revision: p.revision, birthday: { monthDay: '02-29', leapDay: 'mar01' } });
  assert.equal(p.reminders.find((r) => r.key === 'birthday:2027').date, '2027-03-01');
  p = f.run('save', { id: p.id, revision: p.revision, birthday: { monthDay: '02-29', calendar: 'lunar' } });
  assert.equal(p.zodiacHint, '');
  assert.equal(p.reminders.length, 0);
  p = f.run('save', {
    id: p.id,
    revision: p.revision,
    birthday: { monthDay: '02-29', calendar: 'lunar', thisYearDate: '2027-04-05' },
  });
  assert.equal(p.reminders[0].date, '2027-04-05');
});

test('A13/A28: advance handling, birthday edits and restarts preserve this-year state but not next-year state', (t) => {
  const f = fanFixture(t);
  let p = f.create({ birthday: { monthDay: '09-25', advance: true } });
  const early = p.reminders.find((r) => r.key === 'birthday:2026');
  assert.equal(early.actionable, true);
  f.run('reminder-state', { profileId: p.id, key: early.key, status: 'handled' });
  p = f.run('save', { id: p.id, revision: p.revision, birthday: { monthDay: '09-26', advance: true } });
  f.setNow('2026-09-26T04:00:00Z');
  f.restart();
  const today = f.detail(p.id).reminders.find((r) => r.key === 'birthday:2026');
  assert.equal(today.status, 'handled');
  assert.equal(today.actionable, false);
  f.setNow('2027-09-26T04:00:00Z');
  const nextYear = f.detail(p.id).reminders.find((r) => r.key === 'birthday:2027');
  assert.equal(nextYear.status, 'pending');
  assert.equal(nextYear.actionable, true);
});

test('A13: reopening lists only recent missed reminders and keeps handling durable', (t) => {
  const f = fanFixture(t);
  const p = f.create({ birthday: { monthDay: '09-16' } });
  f.record(p.id, 'anniversary', { name: '很早以前', date: '2026-09-01' });
  f.record(p.id, 'anniversary', { name: '昨天错过', date: '2026-09-17' });
  f.restart();
  const reminders = f.detail(p.id).reminders;
  assert.equal(
    reminders.some((r) => r.title === '很早以前'),
    false,
  );
  assert.equal(reminders.find((r) => r.title === '昨天错过').group, 'missed');
  assert.equal(reminders.find((r) => r.key === 'birthday:2026').group, 'missed');
});

test('A22: editing interaction date preserves its identity, original content and revision history', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const first = f.record(p.id, 'note', { body: '原始正文' }, { occurredAt: '2026-09-10T04:00:00Z' });
  f.record(p.id, 'note', { body: '另一条' }, { occurredAt: '2026-09-15T04:00:00Z' });
  f.record(p.id, 'note', { body: '修订正文' }, { id: first.id, revision: first.revision, occurredAt: NOW });
  const detail = f.detail(p.id);
  assert.equal(detail.records.length, 2);
  assert.equal(detail.records[0].id, first.id);
  assert.equal(detail.records[0].data.body, '修订正文');
  assert.equal(detail.records[0].original.body, '原始正文');
  assert.equal(detail.records[0].revisions.length, 1);
  assert.equal(f.run('list').profiles[0].lastInteraction, NOW);
  assert.throws(
    () => f.record(p.id, 'note', { body: '迟到覆盖' }, { id: first.id, revision: first.revision }),
    /已更新/,
  );
  assert.equal(f.detail(p.id).records[0].data.body, '修订正文');
});

test('A10: a confirmed contiguous advance renewal extends the current expiry boundary', (t) => {
  const f = fanFixture(t);
  const p = f.create({ expiryReminders: true });
  f.record(p.id, 'membership', interval('2026-09-01', '2026-09-30'));
  const renewal = f.record(p.id, 'membership', interval('2026-10-01', '2026-10-31'));
  const actual = f.detail(p.id);
  assert.equal(actual.membership.status, 'active');
  assert.equal(actual.membership.expiry.date, '2026-10-31');
  assert.equal(actual.membership.expiry.recordId, renewal.id);
  assert.equal(actual.reminders.find((r) => r.key.startsWith('expiry:')).date, '2026-10-31');
});

test('A24: independently provided baseline metrics preserve the other confirmed metric', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', { type: 'baseline', totalDays: 120, asOf: '2026-09-18' });
  f.record(p.id, 'membership', { type: 'baseline', continuousDays: 100, asOf: '2026-09-18' });
  assert.equal(f.detail(p.id).membership.totalDays, 120);
  assert.equal(f.detail(p.id).membership.continuousDays, 100);
});

test('A24: a same-date continuous baseline cannot exceed an already confirmed total baseline', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', { type: 'baseline', totalDays: 120, asOf: '2026-09-18' });
  assert.throws(
    () => f.record(p.id, 'membership', { type: 'baseline', continuousDays: 130, asOf: '2026-09-18' }),
    /累计|连续/,
  );
  assert.equal(f.detail(p.id).membership.totalDays, 120);
});

test('A25: a handled milestone stays handled after a same-cycle baseline correction and recalculation', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', { type: 'baseline', totalDays: 200, continuousDays: 100, asOf: '2026-09-18' });
  f.record(p.id, 'membership', interval('2026-09-19', '2026-12-31'));
  const milestone = f.detail(p.id).reminders.find((r) => r.key.startsWith('continuous:') && r.threshold === 100);
  assert.equal(milestone.actionable, true);
  f.run('reminder-state', { profileId: p.id, key: milestone.key, status: 'handled' });
  f.record(p.id, 'membership', { type: 'baseline', totalDays: 200, continuousDays: 90, asOf: '2026-09-18' });
  const revised = f.detail(p.id).reminders.find((r) => r.key === milestone.key);
  assert.equal(revised.status, 'handled');
  assert.equal(revised.actionable, false);
  f.setNow('2026-09-28T04:00:00Z');
  f.restart();
  const reachedAgain = f.detail(p.id).reminders.find((r) => r.key === milestone.key);
  assert.equal(reachedAgain.status, 'handled');
  assert.equal(reachedAgain.actionable, false);
  assert.equal(
    revised.revisedBelowThreshold,
    true,
    'the retained handled occurrence identifies the downward correction',
  );
});

test('A25: a confirmed break permits the same continuous milestone in a new cycle', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', interval('2026-06-11', '2026-09-18'));
  const first = f.detail(p.id).reminders.find((r) => r.key.startsWith('continuous:') && r.threshold === 100);
  assert.equal(first.actionable, true);
  f.run('reminder-state', { profileId: p.id, key: first.key, status: 'handled' });
  f.record(p.id, 'membership', interval('2026-10-01', '2027-01-31'));
  f.setNow('2027-01-08T04:00:00Z');
  const second = f
    .detail(p.id)
    .reminders.find((r) => r.key.startsWith('continuous:') && r.threshold === 100 && r.key !== first.key);
  assert.equal(second.status, 'pending');
  assert.equal(second.actionable, true);
  assert.equal(second.date, '2027-01-08');
});

test('A28: moving a one-time or annual anniversary retains its handled occurrence identity', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  for (const annual of [false, true]) {
    const record = f.record(p.id, 'anniversary', { name: '相识纪念', date: '2026-09-18', annual });
    const item = f.detail(p.id).reminders.find((r) => r.key.includes(record.id));
    f.run('reminder-state', { profileId: p.id, key: item.key, status: 'ignored' });
    f.record(p.id, 'anniversary', { ...record.data, date: '2026-09-19' }, { id: record.id, revision: record.revision });
    const moved = f.detail(p.id).reminders.find((r) => r.key === item.key);
    assert.equal(moved.date, '2026-09-19');
    assert.equal(moved.status, 'ignored');
    assert.equal(moved.actionable, false);
  }
});

test('membership auto-creation recovers a newer identity snapshot already consumed on an earlier page', (t) => {
  const f = fanFixture(t);
  const latest = { identity: IDENTITY, name: '当前完整昵称', nameComplete: true, observedAt: NOW };
  f.consume([{ ...latest, kind: 'identity' }]);
  assert.equal(f.run('find', { identity: IDENTITY }), null, 'ordinary identity observations do not auto-create fans');
  const earlier = '2026-06-18T04:00:00.000Z';
  f.consume([
    {
      kind: 'membership',
      name: '上舰时旧昵称',
      observedAt: earlier,
      membership: { type: 'observation', level: 3, observedAt: earlier },
      identitySnapshot: latest,
    },
  ]);
  const p = f.run('find', { identity: IDENTITY });
  assert.equal(p.platformName, '当前完整昵称');
  assert.equal(p.platformObservedAt, NOW);
  assert.equal(p.membership.observedAt, earlier);
  assert.equal(p.records[0].original.observedAt, earlier);
  assert.equal(p.records[0].occurredAt, earlier);
});

test('new membership facts cannot replace a later local nickname using an older attached identity snapshot', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.consume([{ name: '本地已有最新昵称' }]);
  const earlier = '2026-06-18T04:00:00.000Z';
  f.consume([
    {
      kind: 'membership',
      name: '上舰时旧昵称',
      observedAt: earlier,
      membership: { type: 'observation', level: 3, observedAt: earlier },
      identitySnapshot: { identity: IDENTITY, name: '快照里的旧昵称', nameComplete: true, observedAt: earlier },
    },
  ]);
  assert.equal(f.detail(p.id).platformName, '本地已有最新昵称');
});

test('auto-create with auto-update disabled retains the initial membership observation and skips later changes', (t) => {
  const f = fanFixture(t);
  f.run('configure', { autoCreate: true, autoUpdate: false });
  f.consume([
    { kind: 'membership', name: '建档时的昵称', membership: { type: 'observation', level: 3, observedAt: NOW } },
  ]);
  const created = f.run('find', { identity: IDENTITY });
  assert.equal(created.platformName, '建档时的昵称');
  assert.equal(created.membership.observedLevel, 3);
  assert.equal(created.records.length, 1);
  f.consume([
    {
      kind: 'membership',
      name: '关闭自动更新后出现的昵称',
      observedAt: '2026-09-19T04:00:00Z',
      membership: { type: 'observation', level: 1, observedAt: '2026-09-19T04:00:00Z' },
    },
  ]);
  const unchanged = f.detail(created.id);
  assert.equal(unchanged.platformName, '建档时的昵称');
  assert.equal(unchanged.membership.observedLevel, 3);
  assert.equal(unchanged.records.length, 1);
  assert.equal(f.run('settings').cursor, 2);
});
