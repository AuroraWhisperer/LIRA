'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createQueueStore } = require('../../src/storage/queue-store');
const { pruneFanRestoreSnapshots } = require('../../src/storage/fan-snapshot-retention');
const { addQueueItem } = require('../../src/music/queue-service');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');
const { createDatabases, closeDatabases, getSchemaVersions } = require('../../src/storage/database');
const { createLegacyDatabases } = require('../helpers/legacy-databases');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

function oldRequest(f, input = {}, scope = null) {
  const defaults = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false' };
  return addQueueItem(
    {
      store: createQueueStore(f.db.songDb, { getFanScope: () => scope }),
      settings: () => defaults,
      defaults: () => defaults,
    },
    {
      songName: '旧点歌曲目',
      artist: '旧歌手',
      requesterUid: IDENTITY.value,
      requesterIdentityType: 'uid',
      requesterName: '旧昵称',
      createdAt: NOW,
      ...input,
    },
  );
}

test('A29: complete restore preserves song summaries, other record evidence and handled reminder state', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '私密备份备注', birthday: { monthDay: '09-18' } });
  const note = f.record(p.id, 'note', { body: '原始内容' });
  f.record(p.id, 'note', { body: '修订后内容' }, { id: note.id, revision: note.revision });
  f.record(p.id, 'membership', interval('2026-09-01', '2026-12-31'));
  f.record(p.id, 'song', { songName: '备份曲目', artist: '备份歌手', category: '粤语', note: '喜欢现场版' });
  f.record(p.id, 'song', { songName: '备份曲目', artist: '备份歌手', category: '粤语' }, { occurredAt: '2026-09-17T04:00:00Z' });
  f.run('reminder-state', { profileId: p.id, key: 'birthday:2026', status: 'handled' });
  const backup = f.run('backup');
  assert.equal(backup.version, 2);
  const song = backup.profiles[0].records.find((record) => record.kind === 'song');
  f.run('delete', { id: p.id, confirm: true, suppress: false });
  f.consume([{ cursor: 5, name: '未建档的身份快照' }], { nextCursor: 5 });
  const plan = f.run('preview-restore', { backup });
  assert.equal(plan.added, 1);
  assert.equal(plan.updated, 0);
  const result = f.run('restore', {
    backup,
    digest: plan.digest,
    currentDigest: plan.currentDigest,
    conflicts: 'keep',
  });
  assert.ok(result.snapshotId);
  const savedSnapshot = f.db.songDb
    .prepare('SELECT data FROM fan_restore_snapshots WHERE id = ?')
    .get(result.snapshotId);
  assert.equal(JSON.parse(savedSnapshot.data).profiles.length, 0);
  assert.equal(f.run('settings').cursor, 5, 'restore must not claim the backup cursor as current coverage');
  f.restart();
  const restored = f.detail(p.id);
  assert.deepEqual(restored.identity, IDENTITY);
  assert.equal(restored.notes, '私密备份备注');
  assert.equal(restored.records.find((r) => r.id === note.id).data.body, '修订后内容');
  assert.equal(restored.records.find((r) => r.id === note.id).original.body, '原始内容');
  assert.equal(restored.records.find((r) => r.id === note.id).revisions.length, 1);
  assert.deepEqual(restored.songs[0].data, song.data);
  assert.equal(restored.songs[0].data.count, 2);
  assert.deepEqual(restored.songs[0].data.recentDates, ['2026-09-18', '2026-09-17']);
  assert.equal(restored.songs[0].data.note, '喜欢现场版');
  assert.deepEqual(restored.songs[0].original, {});
  assert.deepEqual(restored.songs[0].revisions, []);
  assert.equal(restored.membership.totalDays, 18);
  assert.equal(restored.reminders.find((r) => r.key === 'birthday:2026').status, 'handled');
  assert.equal(restored.reminders.find((r) => r.key === 'birthday:2026').actionable, false);
});

test('version 1 backups combine individual songs while preserving exclusion rules and other record revisions', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const note = f.record(p.id, 'note', { body: '原来的手记' });
  const corrected = f.record(p.id, 'note', { body: '修订手记' }, { id: note.id, revision: note.revision });
  const queued = oldRequest(f, { songName: '雨爱', artist: '测试歌手', categoryName: '流行' }, SCOPE);
  const activeRequest = f.db.songDb.prepare('SELECT * FROM requests WHERE queue_id = ?').get(queued.id);
  assert.equal(activeRequest.fan_recorded, 0);
  const backup = f.run('backup');
  backup.version = 1;
  const requests = [
    { at: '2026-09-18T04:00:00Z', data: { note: '喜欢现场版' } },
    { at: '2026-09-17T17:00:00Z' },
    { at: '2026-09-17T04:00:00Z', data: { excludeFromStats: true } },
    { at: '2026-09-16T04:00:00Z' },
    { at: '2026-08-01T04:00:00Z' },
    { at: '2026-09-18T01:00:00Z', data: { excluded: true } },
    { at: '2026-09-18T02:00:00Z', source: 'random:danmaku' },
  ];
  backup.profiles[0].records.push(...requests.map((request, index) => {
    const data = { songName: '雨爱', artist: '测试歌手', category: '流行', ...request.data };
    return {
      id: `legacy-song-${index}`, profileId: p.id, kind: 'song',
      sourceKey: `request:${index === 0 ? activeRequest.stable_id : `legacy-${index}`}`,
      occurredAt: request.at, data, original: { ...data, source: request.source || 'danmaku' },
      revisions: [{ changedAt: NOW, before: { data: { songName: '旧曲名' } }, after: { data } }], revision: 2,
    };
  }));
  const plan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...plan, conflicts: 'replace' });
  const profile = f.detail(p.id);
  assert.equal(profile.songs.length, 1);
  assert.equal(profile.songs[0].data.count, 5);
  assert.deepEqual(profile.songs[0].data.recentDates, ['2026-09-18', '2026-09-17', '2026-09-16']);
  assert.deepEqual(profile.songs[0].data.dailyCounts, [
    { date: '2026-09-16', category: '流行', count: 1 },
    { date: '2026-09-18', category: '流行', count: 2 },
  ]);
  assert.equal(profile.songs[0].data.note, '喜欢现场版');
  assert.deepEqual(profile.songs[0].original, {});
  assert.deepEqual(profile.songs[0].revisions, []);
  assert.deepEqual(profile.records.find((record) => record.id === note.id), corrected);
  assert.equal(profile.musicStats.days, 30);
  assert.equal(profile.musicStats.count, 3);
  const restoredRequest = f.db.songDb.prepare('SELECT fan_recorded FROM requests WHERE id = ?').get(activeRequest.id);
  assert.equal(restoredRequest.fan_recorded, 1, 'restoring legacy evidence claims its same-account active request');
  assert.equal(f.db.songDb.prepare('SELECT status FROM queue WHERE id = ?').get(queued.id).status, 'waiting');
  f.service.archiveAccepted(SCOPE, {
    stableId: activeRequest.stable_id, requestId: activeRequest.id, queueId: queued.id,
    songName: activeRequest.song_name, artist: activeRequest.artist, categoryName: activeRequest.category_name,
    requesterUid: activeRequest.requester_uid, identityType: activeRequest.identity_type,
    requesterName: activeRequest.requester_name, createdAt: activeRequest.created_at, source: activeRequest.source,
  });
  assert.deepEqual(f.detail(p.id).songs, profile.songs, 'replayed acceptance cannot count the restored song twice');
  const upgraded = f.run('backup');
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.profiles[0].records.filter((record) => record.kind === 'song').length, 1);
  f.run('restore', { backup: upgraded, ...f.run('preview-restore', { backup: upgraded }), conflicts: 'replace' });
  assert.equal(f.detail(p.id).songs[0].data.count, 5, 'replacing from a summary backup must not double the current total');
});

test('restore rejects malformed song totals and dates before changing profiles or snapshots', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'song', { songName: '校验曲目', category: '流行' });
  f.record(p.id, 'song', { songName: '校验曲目', category: '流行' }, { occurredAt: '2026-09-17T04:00:00Z' });
  const backup = f.run('backup');
  f.store.snapshot(SCOPE, backup, NOW);
  const before = f.store.exportScope(SCOPE);
  const snapshots = f.run('snapshots');
  const invalid = [
    ['negative total', (data) => { data.count = -1; }],
    ['fractional total', (data) => { data.count = 1.5; }],
    ['text total', (data) => { data.count = '2'; }],
    ['missing recent dates', (data) => { data.recentDates = []; }],
    ['duplicate recent dates', (data) => { data.recentDates = ['2026-09-18', '2026-09-18']; }],
    ['ascending recent dates', (data) => { data.recentDates.reverse(); }],
    ['invalid calendar date', (data) => { data.recentDates = ['2026-02-30']; }],
    ['too many recent dates', (data) => { data.recentDates.push('2026-09-16', '2026-09-15'); }],
    ['daily count exceeds total', (data) => { data.dailyCounts[0].count = 3; }],
    ['invalid daily count', (data) => { data.dailyCounts[0].count = 0; }],
    ['invalid statistics date', (data) => { data.dailyCounts[0].date = '2026-02-30'; }],
    ['duplicate daily category', (data) => { data.dailyCounts.push({ ...data.dailyCounts[0] }); }],
    ['daily date newer than last request', (data) => { data.dailyCounts[1].date = '2026-09-19'; }],
  ];
  for (const [label, change] of invalid) {
    const damaged = structuredClone(backup);
    change(damaged.profiles[0].records.find((record) => record.kind === 'song').data);
    assert.throws(() => f.run('preview-restore', { backup: damaged }), /点歌|日期|汇总/, label);
  }
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.deepEqual(f.run('snapshots'), snapshots);
});

test('A29: restore requires matching origin/account, complete format and unchanged conflict preview', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '仍要保留' });
  const backup = f.run('backup');
  assert.throws(
    () =>
      f.run('preview-restore', {
        backup: { ...backup, scope: JSON.stringify(['https://other.example', 'streamer-a']) },
      }),
    /归属不匹配/,
  );
  assert.throws(
    () =>
      f.run('preview-restore', {
        backup: { ...backup, scope: JSON.stringify(['https://lira.example', 'streamer-b']) },
      }),
    /归属不匹配/,
  );
  assert.throws(() => f.run('preview-restore', { backup: f.run('export-list') }), /备份格式无效/);
  const plan = f.run('preview-restore', { backup });
  assert.equal(plan.conflicts[0].existingId, p.id);
  f.run('save', { id: p.id, revision: p.revision, notes: '预览后有了新内容' });
  assert.throws(
    () => f.run('restore', { backup, digest: plan.digest, currentDigest: plan.currentDigest, conflicts: 'replace' }),
    /预览已变化/,
  );
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
  f.record(a.id, 'song', { songName: '事务里保留的歌', category: '流行' });
  f.record(a.id, 'song', { songName: '事务里保留的歌', category: '流行' });
  const backup = f.run('backup');
  f.store.snapshot(SCOPE, backup, NOW);
  f.store.snapshot(SCOPE, backup, NOW);
  const before = f.store.exportScope(SCOPE);
  const snapshots = f.run('snapshots');
  const plan = f.run('preview-restore', { backup });
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_restore BEFORE INSERT ON fan_records WHEN NEW.kind = 'note'
    BEGIN SELECT RAISE(ABORT, 'forced fan restore failure'); END;`);
  assert.throws(() => f.run('restore', { backup, ...plan, conflicts: 'replace' }), /forced fan restore failure/);
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.deepEqual(f.run('snapshots'), snapshots, 'failed restoration must recover any snapshot pruned by its insert');
});

test('automatic recovery snapshots keep the newest two per account and insert atomically with pruning', (t) => {
  const f = fanFixture(t);
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  const backup = f.run('backup');
  const otherId = f.store.snapshot(otherScope, { ...backup, scope: otherScope }, NOW);
  const first = f.store.snapshot(SCOPE, backup, NOW);
  const second = f.store.snapshot(SCOPE, backup, NOW);
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_snapshot_prune BEFORE DELETE ON fan_restore_snapshots
    BEGIN SELECT RAISE(ABORT, 'forced snapshot prune failure'); END;`);
  assert.throws(() => f.store.snapshot(SCOPE, backup, NOW), /forced snapshot prune failure/);
  assert.deepEqual(f.run('snapshots').map((entry) => entry.id), [second, first]);
  f.db.songDb.exec('DROP TRIGGER fail_fan_snapshot_prune');
  const third = f.store.snapshot(SCOPE, backup, NOW);
  assert.deepEqual(f.run('snapshots').map((entry) => entry.id), [third, second]);
  assert.throws(() => f.store.getSnapshot(SCOPE, first), /恢复点不存在/);
  assert.deepEqual(f.store.getSnapshot(SCOPE, third), backup);
  assert.deepEqual(f.run('snapshots', {}, otherScope).map((entry) => entry.id), [otherId]);
  f.restart();
  assert.deepEqual(f.run('snapshots').map((entry) => entry.id), [third, second]);
});

test('snapshot retention upgrades existing accounts deterministically and is repeatable', (t) => {
  const f = fanFixture(t);
  const scopes = [SCOPE, JSON.stringify(['https://other.example', 'streamer-a'])];
  const insert = f.db.songDb.prepare('INSERT INTO fan_restore_snapshots VALUES (?, ?, ?, ?)');
  for (const scope of scopes) {
    insert.run(`${scope}-latest`, scope, '2026-09-20T04:00:00.000Z', '{}');
    insert.run(`${scope}-tie-earlier`, scope, NOW, '{}');
    insert.run(`${scope}-tie-later`, scope, NOW, '{}');
    insert.run(`${scope}-oldest`, scope, '2026-09-17T04:00:00.000Z', '{}');
  }
  assert.equal(pruneFanRestoreSnapshots(f.db.songDb), 4);
  for (const scope of scopes) {
    assert.deepEqual(f.run('snapshots', {}, scope).map((entry) => entry.id), [`${scope}-latest`, `${scope}-tie-later`]);
  }
  assert.equal(pruneFanRestoreSnapshots(f.db.songDb), 0);
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

test('clearing all profiles requires confirmation and stays within the current account', (t) => {
  const f = fanFixture(t);
  const active = f.create({ birthday: { monthDay: '09-18' } });
  f.record(active.id, 'note', { body: '当前账号手记' });
  f.run('reminder-state', {
    profileId: active.id,
    key: active.reminders[0].key,
    status: 'handled',
  });
  let archived = f.create({
    alias: '已归档粉丝',
    identity: { ...IDENTITY, value: '900000002' },
  });
  archived = f.run('save', {
    id: archived.id,
    revision: archived.revision,
    archived: true,
  });
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  const other = f.create({ alias: '其他账号档案' }, otherScope);
  f.run('save-record', { profileId: other.id, kind: 'note', data: { body: '不得删除' } }, otherScope);
  f.store.suppress(SCOPE, '["bilibili","uid","900000099"]');

  assert.throws(() => f.run('delete-all'), /确认清除全部档案/);
  assert.equal(f.run('list').profiles.length, 1);
  assert.equal(f.run('list', { archived: true }).profiles.length, 1);

  assert.deepEqual(f.run('delete-all', { confirm: true }), {
    deletedCount: 2,
  });
  assert.equal(f.run('list').profiles.length, 0);
  assert.equal(f.run('list', { archived: true }).profiles.length, 0);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS count FROM fan_records WHERE scope = ?').get(SCOPE).count, 0);
  assert.equal(
    f.db.songDb.prepare('SELECT COUNT(*) AS count FROM fan_reminder_states WHERE scope = ?').get(SCOPE).count,
    0,
  );
  assert.equal(f.run('suppression-list').length, 1);
  assert.equal(f.run('settings').autoCreate, true);
  assert.equal(f.detail(other.id, otherScope).records.length, 1);
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
  assert.equal(first.data.count, 1);
  assert.deepEqual(first.data.recentDates, ['2026-09-18']);
  assert.deepEqual(first.original, {});
  const request = f.db.songDb.prepare('SELECT owner_scope, stable_id, fan_recorded FROM requests WHERE id = 1').get();
  assert.equal(request.owner_scope, SCOPE);
  assert.ok(request.stable_id);
  assert.equal(request.fan_recorded, 1);
  plan = f.run('preview-legacy', input);
  f.run('import-legacy', { ...input, digest: plan.digest, confirmOwnership: true });
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.detail(p.id).songs[0].sourceKey, first.sourceKey);
  assert.equal(f.detail(p.id).songs[0].data.count, 1);
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
  assert.deepEqual(
    result.records.map((r) => r.songName),
    ['业务日最早一笔', '业务日最后一笔'],
  );
});

test('fan schema upgrades existing request history without attributing it and reopens idempotently', (t) => {
  const dataDir = createScratchDirectory('fan-transfer-legacy-');
  let databases = createLegacyDatabases(t, { dataDir }, 5);
  t.after(() => { closeDatabases(databases); removeScratchDirectory(dataDir); });
  assert.equal(getSchemaVersions(databases).songDb, 5);
  databases.songDb.prepare(`INSERT INTO queue (song_name, requester_uid, status, created_at, updated_at)
    VALUES (?, ?, 'waiting', ?, ?)`).run('旧点歌曲目', IDENTITY.value, NOW, NOW);
  databases.songDb.prepare(`INSERT INTO requests (song_name, requester_uid, queue_id, created_at)
    VALUES (?, ?, 1, ?)`).run('旧点歌曲目', IDENTITY.value, NOW);
  closeDatabases(databases);
  databases = createDatabases({ dataDir });
  const currentVersion = getSchemaVersions(databases).songDb;
  const restored = databases.songDb.prepare('SELECT * FROM requests WHERE id = 1').get();
  assert.equal(restored.song_name, '旧点歌曲目');
  assert.equal(restored.requester_uid, IDENTITY.value);
  assert.equal(restored.stable_id, null);
  assert.equal(restored.owner_scope, null);
  assert.equal(restored.identity_type, null);
  assert.equal(databases.songDb.prepare('SELECT COUNT(*) AS n FROM fan_profiles').get().n, 0);
  closeDatabases(databases);
  databases = createDatabases({ dataDir });
  assert.deepEqual(databases.songDb.prepare('SELECT * FROM requests WHERE id = 1').get(), restored);
  assert.equal(getSchemaVersions(databases).songDb, currentVersion);
});
