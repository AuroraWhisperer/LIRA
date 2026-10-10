'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');

test('blacklist hides existing fan content and stops every automatic writer without losing stored records', (t) => {
  const f = fanFixture(t);
  const p = f.create({ birthday: { monthDay: '09-20' }, notes: '应隐藏的资料' });
  f.record(p.id, 'note', { body: '应保留的手记' });
  const song = {
    identityType: 'uid', requesterUid: IDENTITY.value, requesterName: '小海',
    stableId: 'blacklist-song', requestId: 1, queueId: 1, source: 'manual',
    songName: '虚构曲目', artist: '虚构歌手', categoryName: '其他', createdAt: NOW,
  };
  f.service.archiveAccepted(SCOPE, song);
  const before = f.store.get(SCOPE, p.id);
  const records = f.store.records.list(SCOPE, p.id);
  assert.equal(f.run('calendar').length, 1);
  assert.throws(() => f.run('suppress', { id: p.id, revision: before.revision - 1 }), /已更新/);
  f.run('suppress', { id: p.id, revision: before.revision });
  assert.equal(f.run('list').profiles.length, 0);
  assert.equal(f.run('list', { archived: true }).profiles.length, 0);
  assert.equal(f.run('find', { identity: IDENTITY }), null);
  assert.equal(f.run('reminders').length, 0);
  assert.equal(f.run('calendar').length, 0);
  assert.doesNotMatch(f.run('export-list', { fields: ['notes', 'uid'] }), /应隐藏的资料|900000001/);
  assert.throws(() => f.detail(p.id), /黑名单/);
  assert.throws(() => f.run('save', { id: p.id, revision: before.revision, archived: false }), /黑名单/);
  assert.throws(() => f.record(p.id, 'note', { body: '禁止写入' }), /黑名单/);
  assert.throws(() => f.create(), /黑名单/);
  const draft = f.create({ identity: null, alias: '未绑定' });
  assert.throws(() => f.run('save', { id: draft.id, revision: draft.revision, identity: IDENTITY }), /黑名单/);
  assert.throws(() => f.run('preview-merge', { id: draft.id, revision: draft.revision, targetId: p.id }), /黑名单/);
  assert.throws(() => f.run('preview-legacy', { profileId: p.id }), /黑名单/);
  assert.throws(() => f.run('suppress', { id: draft.id, revision: draft.revision }), /绑定/);
  f.service.observeIdentity(SCOPE, { identity: IDENTITY, name: '改过的昵称', nameComplete: true, observedAt: '2026-09-19T04:00:00.000Z' });
  f.consume([{ kind: 'membership', membership: { type: 'observation', level: 1, observedAt: NOW } }]);
  const result = f.service.importGuardRoster(SCOPE, {
    roomId: '1234', ownerUid: '99', observedAt: NOW, skipped: 0,
    members: [{ uid: IDENTITY.value, name: '改过的昵称', level: 1, accompanyDays: 499 }],
  });
  assert.equal(result.skipped, 1);
  f.service.archiveAccepted(SCOPE, { ...song, stableId: 'blocked-song' });
  f.service.archiveQueueState(SCOPE, song.stableId, 'done', NOW);
  assert.deepEqual(f.store.get(SCOPE, p.id), before);
  assert.deepEqual(f.store.records.list(SCOPE, p.id), records);
  assert.equal(f.run('backup').profiles.find((item) => item.id === p.id).records.length, records.length);
  assert.equal(f.run('suppression-list')[0].name, '小海');
  f.restart();
  assert.equal(f.run('find', { identity: IDENTITY }), null);
  assert.equal(f.run('settings').cursor, 1, 'ignored facts still advance the cursor');
  f.run('unsuppress', { identity: IDENTITY, confirm: true });
  assert.equal(f.detail(p.id).records.length, records.length);
  assert.equal(f.run('calendar').length, 1);
  const restored = f.detail(p.id);
  const archived = f.run('save', { id: p.id, revision: restored.revision, archived: true });
  f.run('suppress', { id: p.id, revision: archived.revision });
  assert.equal(f.run('list', { archived: true }).profiles.length, 0);
  f.run('unsuppress', { identity: IDENTITY, confirm: true });
  assert.equal(f.run('list', { archived: true }).profiles[0].id, p.id);
  assert.equal(f.run('calendar').length, 0, 'unblocking preserves the original archived state');
});

test('older backup and snapshot restore preserve the blacklist, which remains scoped to the typed identity and account', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const backup = f.run('backup');
  const snapshotId = f.store.snapshot(SCOPE, backup, NOW);
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  const other = f.create({}, otherScope);
  f.run('suppress', { id: p.id, revision: p.revision });
  const openId = { ...IDENTITY, type: 'open_id' };
  const differentIdentity = f.create({ identity: openId });
  assert.equal(f.run('find', { identity: openId }).id, differentIdentity.id);
  assert.equal(f.run('find', { identity: IDENTITY }, otherScope).id, other.id);
  assert.throws(() => f.run('suppress', { id: other.id, revision: other.revision }), /不属于/);
  const preview = f.run('preview-restore', { backup });
  f.run('restore', { ...preview, backup, conflicts: 'replace' });
  assert.equal(f.run('find', { identity: IDENTITY }), null);
  const snapshot = f.run('preview-snapshot', { snapshotId });
  f.run('restore-snapshot', { ...snapshot, snapshotId, confirm: true });
  assert.equal(f.run('find', { identity: IDENTITY }), null);
  assert.equal(f.run('suppression-list').length, 1);
  f.run('unsuppress', { identity: IDENTITY, confirm: true });
  assert.equal(f.detail(p.id).id, p.id);
  assert.equal(f.run('find', { identity: IDENTITY }, otherScope).id, other.id);
});
