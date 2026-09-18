'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

function roster(members = [{ uid: IDENTITY.value, name: '海边听歌',
  avatar: 'https://i0.hdslb.com/bfs/face/fixture.jpg', level: 3 }]) {
  return { roomId: '1234', ownerUid: '99', observedAt: NOW, members, skipped: 0 };
}

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
  f.service.importGuardRoster(SCOPE, roster([]));
  assert.equal(f.run('find', { identity: IDENTITY }).records.length, 1);
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
