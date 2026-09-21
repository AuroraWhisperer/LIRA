'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

function roster(members = [{ uid: IDENTITY.value, name: '海边听歌',
  avatar: 'https://i0.hdslb.com/bfs/face/fixture.jpg', level: 3 }]) {
  return { roomId: '1234', ownerUid: '99', observedAt: NOW, members, skipped: 0 };
}

test('daily roster setting is opt-in, validates input and survives restart and backup restore', (t) => {
  const f = fanFixture(t);
  assert.equal(f.run('settings').autoSyncGuardRoster, false);
  assert.throws(() => f.run('configure', {
    autoCreate: true, autoUpdate: true, autoSyncGuardRoster: 'true',
  }), /自动更新/);
  f.run('configure', { autoCreate: false, autoUpdate: false, autoSyncGuardRoster: true });
  f.run('configure', { autoCreate: false, autoUpdate: false });
  f.restart();
  assert.equal(f.run('settings').autoSyncGuardRoster, true);
  const backup = f.run('backup');
  f.run('configure', { autoCreate: false, autoUpdate: false, autoSyncGuardRoster: false });
  const preview = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...preview, conflicts: 'keep' });
  assert.equal(f.run('settings').autoSyncGuardRoster, true);
});

test('automatic roster atomically saves a scoped success date and retains it across restarts', (t) => {
  const f = fanFixture(t);
  const profile = f.create({ notes: '保留私人资料' });
  f.service.importGuardRoster(SCOPE, roster(), '2026-09-18');
  assert.deepEqual(f.run('settings').lastGuardRosterAutoUpdate, { date: '2026-09-18', roomId: '1234' });
  assert.match(f.detail(profile.id).records[0].data.reason, /自动同步/);
  assert.equal(f.detail(profile.id).notes, '保留私人资料');
  f.restart();
  assert.equal(f.run('settings').lastGuardRosterAutoUpdate.date, '2026-09-18');
  const before = f.detail(profile.id);
  assert.throws(() => f.service.importGuardRoster(SCOPE, { ...roster([
    { uid: IDENTITY.value, name: '不应保存的新名字', level: 1 },
    { uid: '900000002', level: 4 },
  ]), observedAt: '2026-09-19T04:10:00.000Z' }, '2026-09-19'));
  assert.deepEqual(f.detail(profile.id), before);
  assert.equal(f.run('settings').lastGuardRosterAutoUpdate.date, '2026-09-18');
  f.service.importGuardRoster(SCOPE, roster());
  assert.equal(f.run('settings').lastGuardRosterAutoUpdate.date, '2026-09-18');
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  assert.equal(f.run('settings', {}, otherScope).lastGuardRosterAutoUpdate, undefined);
});

test('daily roster refresh changes guard ranks and removes current identity for former guards without erasing history', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '私人备注' });
  f.service.importGuardRoster(SCOPE, roster(), '2026-09-18');
  assert.equal(f.detail(p.id).currentGuardLevel, 3);
  f.service.importGuardRoster(SCOPE, { ...roster([{ uid: IDENTITY.value, name: '海边听歌', level: 2 }]),
    observedAt: '2026-09-19T04:10:00.000Z' }, '2026-09-19');
  assert.equal(f.detail(p.id).currentGuardLevel, 2);
  const records = f.detail(p.id).records;
  f.service.importGuardRoster(SCOPE, { ...roster([]), observedAt: '2026-09-20T04:10:00.000Z' }, '2026-09-20');
  f.restart();
  assert.equal(f.detail(p.id).currentGuardLevel, null);
  assert.equal(f.detail(p.id).notes, '私人备注');
  assert.deepEqual(f.detail(p.id).records, records);
  assert.equal(f.run('list', { filters: ['active'] }).profiles.length, 0);
  assert.equal(f.detail(p.id).membership.expiry, null);
});

test('manual roster import creates basic profiles even with automatic updates disabled', (t) => {
  const f = fanFixture(t);
  f.run('configure', { autoCreate: false, autoUpdate: false });
  const result = f.service.importGuardRoster(SCOPE, roster());
  assert.deepEqual(result, { roomId: '1234', ownerUid: '99', total: 1, created: 1, updated: 0, skipped: 0 });
  const p = f.run('find', { identity: IDENTITY });
  assert.equal(p.platformName, '海边听歌');
  assert.equal(p.alias, '');
  assert.ok(p.avatar);
  assert.equal(p.membership.observedLevel, 3);
  assert.equal(p.currentGuardLevel, 3);
  assert.equal(f.run('list', { filters: ['active'] }).profiles.length, 1);
  assert.equal(f.run('list', { filters: ['unknown'] }).profiles.length, 0);
  assert.equal(p.membership.expiry, null);
  assert.equal(p.membership.totalDays, null);
  assert.equal(p.membership.continuousDays, null);
  assert.equal(p.records[0].original.roomId, '1234');
  f.restart();
  assert.equal(f.run('find', { identity: IDENTITY }).platformName, '海边听歌');
});

test('manual roster import preserves private fields, existing history and repeated observation revisions', (t) => {
  const f = fanFixture(t);
  const original = f.create({ notes: '私人备注', summary: '常听民谣', favorite: true });
  f.record(original.id, 'note', { body: '一起聊过旅行' });
  f.service.importGuardRoster(SCOPE, roster());
  const observed = f.detail(original.id).records.find((r) => r.kind === 'membership');
  f.run('save-record', { profileId: original.id, id: observed.id, revision: observed.revision,
    data: { ...observed.data, level: 2, reason: '人工核对' } });
  const again = f.service.importGuardRoster(SCOPE, { ...roster(), observedAt: '2026-09-18T05:00:00.000Z' });
  assert.equal(again.created, 0);
  const p = f.detail(original.id);
  assert.equal(p.alias, '小海');
  assert.equal(p.notes, '私人备注');
  assert.equal(p.summary, '常听民谣');
  assert.equal(p.favorite, true);
  assert.equal(p.records.length, 2);
  assert.equal(p.records.find((r) => r.kind === 'membership').data.reason, '人工核对');
  assert.equal(p.records.find((r) => r.kind === 'membership').original.level, 3);
});

test('manual import skips archived and suppressed profiles, and never merges another identity namespace or scope', (t) => {
  const f = fanFixture(t);
  const archived = f.create({ archived: true });
  const deleted = f.create({ identity: { ...IDENTITY, value: '900000002' } });
  f.run('delete', { id: deleted.id, confirm: true, suppress: true });
  const openId = f.create({ identity: { ...IDENTITY, type: 'open_id', value: '900000003' } });
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  f.run('create', { alias: '另一个主播的档案', identity: { ...IDENTITY, value: '900000004' } }, otherScope);
  const result = f.service.importGuardRoster(SCOPE, roster([1, 2, 3, 4].map((n) => ({
    uid: `90000000${n}`, name: `虚构粉丝${n}`, level: 3,
  }))));
  assert.equal(result.skipped, 2);
  assert.equal(result.created, 2);
  assert.equal(f.detail(archived.id).records.length, 0);
  assert.equal(f.detail(openId.id).records.length, 0);
  assert.equal(f.run('list', {}, otherScope).profiles.length, 1);
});

test('manual roster import is atomic and does not infer absence as an expired membership', (t) => {
  const f = fanFixture(t);
  assert.throws(() => f.service.importGuardRoster(SCOPE, roster([
    { uid: IDENTITY.value, name: '虚构粉丝', level: 3 },
    { uid: '900000002', name: '无效等级', level: 4 },
  ])));
  assert.equal(f.run('list').profiles.length, 0);
  f.service.importGuardRoster(SCOPE, roster());
  f.service.importGuardRoster(SCOPE, { ...roster([]), observedAt: '2026-09-18T05:00:00.000Z' });
  const missing = f.run('find', { identity: IDENTITY });
  assert.equal(missing.records.length, 1);
  assert.equal(missing.currentGuardLevel, null);
  assert.equal(missing.membership.expiry, null);
  assert.equal(missing.membership.totalDays, null);
  assert.equal(f.run('list', { filters: ['active'] }).profiles.length, 0);
  assert.equal(f.run('list', { filters: ['past'] }).profiles.length, 1);
  assert.equal(f.run('list', { filters: ['unknown'] }).profiles.length, 0);
});

test('current roster roles survive absence, rejoining, restart and backup without changing private history', (t) => {
  const f = fanFixture(t);
  const complete = f.create({ summary: '常听民谣', notes: '保留备注', birthday: { monthDay: '09-19' } });
  f.record(complete.id, 'note', { body: '一起聊过旅行' });
  const members = [3, 2, 1].map((level, index) => ({ uid: `90000000${index + 1}`, name: `虚构粉丝${index + 1}`, level }));
  f.service.importGuardRoster(SCOPE, roster(members));
  for (const member of members) {
    const p = f.run('find', { identity: { ...IDENTITY, value: member.uid } });
    assert.equal(p.currentGuardLevel, member.level);
    assert.equal(p.membership.expiry, null);
  }
  const at = '2026-09-18T05:00:00.000Z';
  f.setNow(at);
  f.service.importGuardRoster(SCOPE, { ...roster(members.slice(2)), observedAt: at });
  const remaining = f.run('list', { filters: ['active'] }).profiles;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].currentGuardLevel, 1);
  assert.equal(f.detail(complete.id).notes, '保留备注');
  assert.equal(f.detail(complete.id).records.length, 2);
  assert.equal(f.run('find', { identity: { ...IDENTITY, value: '900000002' } }).currentGuardLevel, null);
  f.restart();
  assert.equal(f.detail(complete.id).currentGuardLevel, null);
  const backup = f.run('backup');
  const later = '2026-09-18T06:00:00.000Z';
  f.setNow(later);
  f.service.importGuardRoster(SCOPE, { ...roster(members), observedAt: later });
  assert.equal(f.detail(complete.id).currentGuardLevel, 3);
  assert.equal(f.detail(complete.id).records.length, 2, 'same-day rejoining does not duplicate unchanged historical evidence');
  const preview = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...preview, conflicts: 'replace' });
  assert.equal(f.detail(complete.id).currentGuardLevel, null);
  assert.equal(f.run('list', { filters: ['active'] }).profiles[0].currentGuardLevel, 1);
});

test('unidentified roster members, other rooms and stale imports do not clear newer current roles', (t) => {
  const f = fanFixture(t);
  f.service.importGuardRoster(SCOPE, roster());
  const p = f.run('find', { identity: IDENTITY });
  f.service.importGuardRoster(SCOPE, { ...roster([]), skipped: 1, observedAt: '2026-09-18T05:00:00.000Z' });
  assert.equal(f.detail(p.id).currentGuardLevel, 3);
  f.service.importGuardRoster(SCOPE, { ...roster([]), roomId: '5678', ownerUid: '88', observedAt: '2026-09-18T06:00:00.000Z' });
  assert.equal(f.detail(p.id).currentGuardLevel, 3);
  f.service.importGuardRoster(SCOPE, { ...roster([{ uid: IDENTITY.value, level: 2 }]), observedAt: '2026-09-18T07:00:00.000Z' });
  f.service.importGuardRoster(SCOPE, { ...roster([]), observedAt: '2026-09-18T06:00:00.000Z' });
  assert.equal(f.detail(p.id).currentGuardLevel, 2);
  const before = f.detail(p.id);
  assert.throws(() => f.service.importGuardRoster(SCOPE, { ...roster([
    { uid: IDENTITY.value, level: 1 }, { uid: '900000002', level: 4 },
  ]), observedAt: '2026-09-18T08:00:00.000Z' }));
  assert.deepEqual(f.detail(p.id), before);
});

test('old backups derive roster roles without requiring new fields and reject invalid new snapshots', (t) => {
  const f = fanFixture(t);
  f.service.importGuardRoster(SCOPE, roster());
  const backup = f.run('backup');
  for (const p of backup.profiles) delete p.guardRoster;
  const preview = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...preview, conflicts: 'replace' });
  assert.equal(f.run('find', { identity: IDENTITY }).currentGuardLevel, 3);
  assert.equal(f.run('list', { filters: ['active'] }).profiles.length, 1);
  const invalid = f.run('backup');
  invalid.profiles[0].guardRoster = { roomId: '1234', ownerUid: '99', observedAt: NOW, level: 4 };
  assert.throws(() => f.run('preview-restore', { backup: invalid }), /大航海名单/);
});

test('repeated same-day imports retain an actual level change back to a previously observed level', (t) => {
  const f = fanFixture(t);
  f.service.importGuardRoster(SCOPE, roster());
  const at = '2026-09-18T05:00:00.000Z';
  f.service.importGuardRoster(SCOPE, { ...roster([{ uid: IDENTITY.value, name: '海边听歌', level: 2 }]), observedAt: at });
  f.setNow('2026-09-18T06:00:00.000Z');
  f.service.importGuardRoster(SCOPE, { ...roster(), observedAt: '2026-09-18T06:00:00.000Z' });
  const p = f.run('find', { identity: IDENTITY });
  assert.equal(p.membership.observedLevel, 3);
  assert.equal(p.records.length, 3);
});

test('profiles sort by guard rank, then fan medal level and recency, and retain ordering', (t) => {
  const f = fanFixture(t);
  f.service.importGuardRoster(SCOPE, roster([
    { uid: IDENTITY.value, name: '低灯牌', level: 1, medalLevel: 12 },
    { uid: '900000002', name: '高灯牌舰长', level: 3, medalLevel: 32 },
    { uid: '900000003', name: '无灯牌提督', level: 2 },
    { uid: '900000004', name: '高灯牌总督', level: 1, medalLevel: 28 },
  ]));
  const low = f.run('find', { identity: IDENTITY });
  f.setNow('2026-09-18T06:00:00.000Z');
  f.record(low.id, 'note', { body: '更晚的互动不应改变灯牌排序' });
  const ordered = () => f.run('list').profiles.map((p) => p.identity.value);
  const expected = ['900000004', IDENTITY.value, '900000003', '900000002'];
  assert.deepEqual(ordered(), expected);
  assert.equal(f.run('list', { query: '低灯牌' }).profiles[0].id, low.id);
  const captain = f.run('find', { identity: { ...IDENTITY, value: '900000002' } });
  let starred = f.run('save', { id: captain.id, revision: captain.revision, favorite: true });
  assert.deepEqual(ordered(), ['900000002', ...expected.slice(0, 3)]);
  const other = f.run('save', { id: low.id, revision: f.detail(low.id).revision, favorite: true });
  assert.deepEqual(ordered(), [IDENTITY.value, '900000002', '900000004', '900000003']);
  f.run('save', { id: other.id, revision: other.revision, favorite: false });
  f.restart();
  assert.deepEqual(ordered(), ['900000002', ...expected.slice(0, 3)]);
  starred = f.detail(starred.id);
  f.run('save', { id: starred.id, revision: starred.revision, favorite: false });
  assert.deepEqual(ordered(), expected);
  const backup = f.run('backup');
  const preview = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...preview, conflicts: 'replace' });
  assert.deepEqual(ordered(), expected);
});

test('same-day medal changes update ordering without duplicating unchanged evidence or overwriting revisions', (t) => {
  const f = fanFixture(t);
  f.service.importGuardRoster(SCOPE, roster());
  const p = f.run('find', { identity: IDENTITY });
  const original = p.records[0];
  f.run('save-record', { profileId: p.id, id: original.id, revision: original.revision,
    data: { ...original.data, reason: '人工核对' } });
  const snapshot = roster([{ uid: IDENTITY.value, name: '海边听歌', level: 3, medalLevel: 25 }]);
  snapshot.observedAt = '2026-09-18T04:30:00.000Z';
  f.service.importGuardRoster(SCOPE, snapshot);
  f.service.importGuardRoster(SCOPE, snapshot);
  assert.equal(f.detail(p.id).records.length, 2);
  assert.equal(f.detail(p.id).records.find((r) => r.id === original.id).data.reason, '人工核对');
  f.service.importGuardRoster(SCOPE, { ...snapshot, observedAt: '2026-09-18T05:00:00.000Z',
    members: [{ ...snapshot.members[0], medalLevel: 26 }] });
  assert.equal(f.detail(p.id).records.length, 3);
  const revised = f.detail(p.id).records.find((r) => r.id === original.id);
  f.run('save-record', { profileId: p.id, id: original.id, revision: revised.revision,
    occurredAt: '2026-09-18T06:00:00.000Z', data: revised.data });
  assert.equal(f.run('list').profiles[0].medalLevel, 26);
});
