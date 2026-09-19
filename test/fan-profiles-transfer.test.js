'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createQueueStore } = require('../src/storage/queue-store');
const { addQueueItem } = require('../src/music/queue-service');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

function oldRequest(f, input = {}, scope = null) {
  const defaults = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false' };
  return addQueueItem({ store: createQueueStore(f.db.songDb, { getFanScope: () => scope }),
    settings: () => defaults, defaults: () => defaults }, {
    songName: '旧点歌曲目', artist: '旧歌手', requesterUid: IDENTITY.value,
    requesterIdentityType: 'uid', requesterName: '旧昵称', createdAt: NOW, ...input,
  });
}

test('A29: complete restore preserves identity, original evidence, revision and handled reminder state', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '私密备份备注', birthday: { monthDay: '09-18' } });
  const note = f.record(p.id, 'note', { body: '原始内容' });
  f.record(p.id, 'note', { body: '修订后内容' }, { id: note.id, revision: note.revision });
  f.record(p.id, 'membership', interval('2026-09-01', '2026-12-31'));
  f.service.archiveAccepted(SCOPE, { stableId: 'permanent-request-id', requestId: 1, queueId: 1,
    requesterUid: IDENTITY.value, identityType: 'uid', requesterName: '海边听歌',
    songName: '备份曲目', artist: '备份歌手', categoryName: '粤语', createdAt: NOW, source: 'danmaku' });
  f.run('reminder-state', { profileId: p.id, key: 'birthday:2026', status: 'handled' });
  const backup = f.run('backup');
  f.run('delete', { id: p.id, confirm: true, suppress: false });
  f.consume([{ cursor: 5, name: '未建档的身份快照' }], { nextCursor: 5 });
  const plan = f.run('preview-restore', { backup });
  assert.equal(plan.added, 1);
  assert.equal(plan.updated, 0);
  const result = f.run('restore', { backup, digest: plan.digest, currentDigest: plan.currentDigest, conflicts: 'keep' });
  assert.ok(result.snapshotId);
  const savedSnapshot = f.db.songDb.prepare('SELECT data FROM fan_restore_snapshots WHERE id = ?').get(result.snapshotId);
  assert.equal(JSON.parse(savedSnapshot.data).profiles.length, 0);
  assert.equal(f.run('settings').cursor, 5, 'restore must not claim the backup cursor as current coverage');
  f.restart();
  const restored = f.detail(p.id);
  assert.deepEqual(restored.identity, IDENTITY);
  assert.equal(restored.notes, '私密备份备注');
  assert.equal(restored.records.find((r) => r.id === note.id).data.body, '修订后内容');
  assert.equal(restored.records.find((r) => r.id === note.id).original.body, '原始内容');
  assert.equal(restored.records.find((r) => r.id === note.id).revisions.length, 1);
  assert.equal(restored.songs[0].sourceKey, 'request:permanent-request-id');
  assert.equal(restored.membership.totalDays, 18);
  assert.equal(restored.reminders.find((r) => r.key === 'birthday:2026').status, 'handled');
  assert.equal(restored.reminders.find((r) => r.key === 'birthday:2026').actionable, false);
});

test('A29: restore requires matching origin/account, complete format and unchanged conflict preview', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '仍要保留' });
  const backup = f.run('backup');
  assert.throws(() => f.run('preview-restore', { backup: { ...backup,
    scope: JSON.stringify(['https://other.example', 'streamer-a']) } }), /归属不匹配/);
  assert.throws(() => f.run('preview-restore', { backup: { ...backup,
    scope: JSON.stringify(['https://lira.example', 'streamer-b']) } }), /归属不匹配/);
  assert.throws(() => f.run('preview-restore', { backup: f.run('export-list') }), /备份格式无效/);
  const plan = f.run('preview-restore', { backup });
  assert.equal(plan.conflicts[0].existingId, p.id);
  f.run('save', { id: p.id, revision: p.revision, notes: '预览后有了新内容' });
  assert.throws(() => f.run('restore', { backup, digest: plan.digest,
    currentDigest: plan.currentDigest, conflicts: 'replace' }), /预览已变化/);
  assert.equal(f.detail(p.id).notes, '预览后有了新内容');
  const currentPlan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...currentPlan, conflicts: 'keep' });
  assert.equal(f.detail(p.id).notes, '预览后有了新内容');
});

test('A29: restore failures leave both current profiles and pre-restore snapshot table unchanged', (t) => {
  const f = fanFixture(t);
  const a = f.create();
  const b = f.create({ identity: { ...IDENTITY, value: '900000002' }, alias: '阿遥' });
  f.record(a.id, 'note', { body: '甲原来的内容' });
  f.record(b.id, 'note', { body: '乙原来的内容' });
  const backup = f.run('backup');
  const before = f.store.exportScope(SCOPE);
  const snapshotCount = f.db.songDb.prepare('SELECT COUNT(*) AS n FROM fan_restore_snapshots').get().n;
  const plan = f.run('preview-restore', { backup });
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_restore BEFORE INSERT ON fan_records
    BEGIN SELECT RAISE(ABORT, 'forced fan restore failure'); END;`);
  assert.throws(() => f.run('restore', { backup, ...plan, conflicts: 'replace' }), /forced fan restore failure/);
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM fan_restore_snapshots').get().n, snapshotCount);
});

test('A19: archived profiles can restore, and deletion suppression survives backup and membership replay', (t) => {
  const f = fanFixture(t);
  let p = f.create();
  p = f.run('save', { id: p.id, revision: p.revision, archived: true });
  assert.equal(f.run('list').profiles.length, 0);
  assert.equal(f.run('list', { archived: true }).profiles[0].id, p.id);
  p = f.run('save', { id: p.id, revision: p.revision, archived: false });
  assert.equal(f.run('list').profiles[0].id, p.id);
  f.run('delete', { id: p.id, confirm: true, suppress: true });
  const backup = f.run('backup');
  assert.equal(backup.suppressions.length, 1);
  f.restart();
  f.consume([{ kind: 'membership', membership: { type: 'observation', level: 3, observedAt: NOW } }]);
  assert.equal(f.run('find', { identity: IDENTITY }), null);
  assert.equal(f.run('backup').suppressions[0], backup.suppressions[0]);
});

test('A29: legacy request import previews scope/range, requires confirmation and deduplicates assigned UUIDs', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  oldRequest(f);
  oldRequest(f, { createdAt: '2026-09-17T04:00:00Z' });
  oldRequest(f, {}, JSON.stringify(['https://lira.example', 'streamer-b']));
  oldRequest(f, { requesterIdentityType: 'open_id' });
  f.db.songDb.prepare('UPDATE requests SET stable_id = NULL, identity_type = NULL WHERE id = 1').run();
  const input = { profileId: p.id, from: '2026-09-18', to: '2026-09-18' };
  let plan = f.run('preview-legacy', input);
  assert.equal(plan.count, 1);
  assert.equal(plan.unownedCount, 1);
  assert.equal(f.detail(p.id).songs.length, 0);
  assert.throws(() => f.run('import-legacy', { ...input, digest: plan.digest }), /确认旧点歌记录归属/);
  f.run('import-legacy', { ...input, digest: plan.digest, confirmOwnership: true });
  const first = f.detail(p.id).songs[0];
  assert.ok(first.original.stableId);
  assert.equal(first.original.source, 'confirmed-local-history');
  assert.equal(f.db.songDb.prepare('SELECT owner_scope FROM requests WHERE id = 1').get().owner_scope, SCOPE);
  plan = f.run('preview-legacy', input);
  f.run('import-legacy', { ...input, digest: plan.digest, confirmOwnership: true });
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.detail(p.id).songs[0].sourceKey, first.sourceKey);
});

test('A16/A29: ordinary list export excludes sensitive fields by default and quotes selected CSV cells', (t) => {
  const f = fanFixture(t);
  f.create({ alias: '=SUM(A1)', notes: '私密正文', birthday: { monthDay: '09-19' }, mbti: 'INFP' });
  const standard = f.run('export-list');
  assert.equal(standard.includes('私密正文'), false);
  assert.equal(standard.includes('INFP'), false);
  assert.equal(standard.includes('09-19'), false);
  assert.ok(standard.includes('"\'=SUM(A1)"'));
  const selected = f.run('export-list', { fields: ['alias', 'notes'] });
  assert.ok(selected.includes('私密正文'));
  assert.throws(() => f.run('export-list', { fields: ['rawData'] }), /字段无效/);
});

test('A29: legacy date ranges use Shanghai business dates at both UTC midnight boundaries', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  oldRequest(f, { songName: '业务日最早一笔', createdAt: '2026-09-17T16:00:00Z' });
  oldRequest(f, { songName: '业务日最后一笔', createdAt: '2026-09-18T15:59:59Z' });
  oldRequest(f, { songName: '已经是次日', createdAt: '2026-09-18T16:00:00Z' });
  const result = f.run('preview-legacy', { profileId: p.id, from: '2026-09-18', to: '2026-09-18' });
  assert.deepEqual(result.records.map((r) => r.songName), ['业务日最早一笔', '业务日最后一笔']);
});

test('fan schema upgrades existing request history without attributing it and reopens idempotently', (t) => {
  const f = fanFixture(t);
  oldRequest(f);
  f.db.songDb.exec(`DROP TABLE fan_records;
    DROP TABLE fan_reminder_states;
    DROP TABLE fan_profiles;
    DROP TABLE fan_scopes;
    DROP TABLE fan_suppressions;
    DROP TABLE fan_restore_snapshots;
    DROP INDEX idx_requests_stable_id;
    ALTER TABLE requests DROP COLUMN stable_id;
    ALTER TABLE requests DROP COLUMN owner_scope;
    ALTER TABLE requests DROP COLUMN identity_type;
    UPDATE schema_version SET version = 5 WHERE key = 'song_db';`);
  f.restart();
  const restored = f.db.songDb.prepare('SELECT * FROM requests WHERE id = 1').get();
  assert.equal(restored.song_name, '旧点歌曲目');
  assert.equal(restored.requester_uid, IDENTITY.value);
  assert.equal(restored.stable_id, null);
  assert.equal(restored.owner_scope, null);
  assert.equal(restored.identity_type, null);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM fan_profiles').get().n, 0);
  f.restart();
  assert.deepEqual(f.db.songDb.prepare('SELECT * FROM requests WHERE id = 1').get(), restored);
  assert.equal(f.db.songDb.prepare("SELECT version FROM schema_version WHERE key = 'song_db'").get().version, 7);
});
