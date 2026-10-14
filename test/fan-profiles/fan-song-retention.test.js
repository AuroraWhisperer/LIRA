'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runMigrations } = require('../../src/storage/schema');
const { migrateFanSongRetention } = require('../../src/storage/fan-song-migration');
const { createQueueStore } = require('../../src/storage/queue-store');
const { addQueueItem } = require('../../src/music/queue-service');
const { applyRetentionPolicies } = require('../../src/storage/retention');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');

function rawSong(f, profileId, id, occurredAt, data = {}, sourceKey = null) {
  const value = { songName: '旧歌曲', artist: '歌手', category: '国语', note: '', ...data };
  const record = {
    id, kind: 'song', sourceKey, occurredAt, data: value,
    original: { ...value, message: '不再保留的逐次原文' }, revisions: [{ before: '旧修改' }], revision: 2,
  };
  f.db.songDb.prepare(`INSERT INTO fan_records
    (id, scope, profile_id, kind, source_key, occurred_at, data, original, revisions, revision)
    VALUES (?, ?, ?, 'song', ?, ?, ?, ?, ?, 2)`).run(
    id, SCOPE, profileId, sourceKey, occurredAt, JSON.stringify(value),
    JSON.stringify(record.original), JSON.stringify(record.revisions),
  );
  return record;
}

function oldQueue(f) {
  const defaults = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false' };
  const store = createQueueStore(f.db.songDb, { getFanScope: () => SCOPE });
  const item = addQueueItem({ store, settings: () => defaults, defaults: () => defaults }, {
    songName: '旧歌曲', artist: '歌手', categoryName: '国语', requesterName: '小海',
    requesterUid: IDENTITY.value, requesterIdentityType: 'uid', createdAt: NOW,
  });
  return f.db.songDb.prepare('SELECT * FROM requests WHERE queue_id = ?').get(item.id);
}

function upgrade(f) {
  return runMigrations(f.db.songDb, 'song_db', [...Array(12).fill(null), migrateFanSongRetention]);
}

function legacyFixture(t) {
  const schema = require('../../src/storage/schema');
  const migrate = schema.runMigrations;
  const legacy = t.mock.method(schema, 'runMigrations', (db, key, steps) =>
    migrate(db, key, key === 'song_db' ? steps.slice(0, 12) : steps));
  try { return fanFixture(t); } finally { legacy.mock.restore(); }
}

test('v13 compacts existing songs and snapshots, retains active replay protection and upgrades once', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = legacyFixture(t);
  const p = f.create();
  const request = oldQueue(f);
  f.record(p.id, 'preference', { sentiment: 'like', label: '轻音乐', reason: '本人确认' });
  const raw = [
    rawSong(f, p.id, 'raw-1', NOW, {}, `request:${request.stable_id}`),
    rawSong(f, p.id, 'raw-2', '2026-09-17T16:30:00Z', { category: '粤语' }),
    rawSong(f, p.id, 'raw-3', '2026-09-16T04:00:00Z', { note: '人工说明' }),
    rawSong(f, p.id, 'raw-4', '2026-08-20T00:00:00Z', { excludeFromStats: true }),
    rawSong(f, p.id, 'raw-5', '2026-06-01T00:00:00Z'),
    rawSong(f, p.id, 'raw-excluded', NOW, { excluded: true }),
  ];
  const preference = f.store.records.list(SCOPE, p.id).find((record) => record.kind === 'preference');
  const backup = {
    format: 'lira-fan-profiles', version: 1, scope: SCOPE, exportedAt: NOW,
    profiles: [{ ...f.store.get(SCOPE, p.id), records: [...raw, preference], reminders: [] }],
    settings: f.run('settings'), suppressions: [],
  };
  for (let i = 0; i < 4; i++) f.db.songDb.prepare('INSERT INTO fan_restore_snapshots VALUES (?, ?, ?, ?)')
    .run(`snapshot-${i}`, SCOPE, NOW, JSON.stringify(backup));
  const terminal = oldQueue(f);
  f.db.songDb.prepare("UPDATE queue SET status = 'done' WHERE id = ?").run(terminal.queue_id);
  assert.equal(f.db.songDb.prepare('PRAGMA table_info(requests)').all().some((column) => column.name === 'fan_recorded'), false);

  assert.equal(upgrade(f).applied, 1);
  const detail = f.detail(p.id);
  assert.equal(detail.songs.length, 1);
  assert.equal(detail.songs[0].data.count, 5);
  assert.deepEqual(detail.songs[0].data.recentDates, ['2026-09-18', '2026-09-16', '2026-08-20']);
  assert.deepEqual({ ...detail.musicStats.categories }, { 国语: 2, 粤语: 1 });
  assert.equal(detail.musicStats.count, 3);
  assert.equal(detail.songs[0].data.note, '人工说明');
  assert.deepEqual(detail.songs[0].original, {});
  assert.deepEqual(detail.songs[0].revisions, []);
  assert.deepEqual(detail.preferences[0], preference);
  assert.equal(f.db.songDb.prepare('SELECT fan_recorded FROM requests WHERE id = ?').get(request.id).fan_recorded, 1);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) n FROM queue').get().n, 1);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) n FROM requests').get().n, 1);
  const snapshots = f.db.songDb.prepare('SELECT id, data FROM fan_restore_snapshots ORDER BY id').all();
  assert.deepEqual(snapshots.map((row) => row.id), ['snapshot-2', 'snapshot-3']);
  for (const row of snapshots) {
    const saved = JSON.parse(row.data);
    assert.equal(saved.version, 2);
    assert.equal(saved.profiles[0].records.filter((record) => record.kind === 'song').length, 1);
    assert.doesNotMatch(row.data, /不再保留的逐次原文/);
  }
  f.service.archiveAccepted(SCOPE, {
    ...request, stableId: request.stable_id, source: request.source,
    identityType: 'uid', requesterUid: IDENTITY.value,
  });
  assert.equal(f.detail(p.id).songs[0].data.count, 5);
  const before = f.run('backup');
  f.restart();
  assert.deepEqual(f.run('backup'), before);
  // Explicit helper repetition also leaves compact counts and retained snapshots unchanged.
  f.store.transaction(() => migrateFanSongRetention(f.db.songDb));
  assert.deepEqual(f.run('backup'), before);
});

test('failed source deletion rolls back song conversion, snapshot pruning and migration version', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = legacyFixture(t);
  const p = f.create();
  const request = oldQueue(f);
  rawSong(f, p.id, 'raw', NOW, {}, `request:${request.stable_id}`);
  f.db.songDb.prepare("UPDATE queue SET status = 'deleted' WHERE id = ?").run(request.queue_id);
  const rawBefore = f.db.songDb.prepare('SELECT * FROM fan_records').all();
  for (let i = 0; i < 3; i++) f.db.songDb.prepare('INSERT INTO fan_restore_snapshots VALUES (?, ?, ?, ?)')
    .run(`rollback-${i}`, SCOPE, NOW, JSON.stringify({ version: 1, profiles: [] }));
  const snapshotsBefore = f.db.songDb.prepare('SELECT * FROM fan_restore_snapshots').all();
  f.db.songDb.exec(`CREATE TRIGGER fail_old_request_delete BEFORE DELETE ON requests
    BEGIN SELECT RAISE(ABORT, 'cannot delete history'); END;`);
  assert.throws(() => upgrade(f), /cannot delete history/);
  assert.deepEqual(f.db.songDb.prepare('SELECT * FROM fan_records').all(), rawBefore);
  assert.deepEqual(f.db.songDb.prepare('SELECT * FROM fan_restore_snapshots').all(), snapshotsBefore);
  assert.equal(f.db.songDb.prepare("SELECT version FROM schema_version WHERE key = 'song_db'").get().version, 12);
  assert.equal(f.db.songDb.prepare('PRAGMA table_info(requests)').all().some((column) => column.name === 'fan_recorded'), false,
    'a failed v13 migration also rolls back its new column');
  f.db.songDb.exec('DROP TRIGGER fail_old_request_delete');
  assert.equal(upgrade(f).applied, 1);
  assert.equal(f.detail(p.id).songs[0].data.count, 1);
});

test('startup retention expires daily counts but preserves totals, latest dates and active request context', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'song', { songName: '长期歌曲', category: '国语' });
  const request = oldQueue(f);
  t.mock.timers.setTime(Date.parse('2026-11-01T04:00:00Z'));
  const before = f.store.records.list(SCOPE, p.id)[0];
  applyRetentionPolicies(f.db, { dryRun: true, policy: { requestDays: 1 } });
  assert.deepEqual(f.store.records.list(SCOPE, p.id)[0], before);
  applyRetentionPolicies(f.db, { policy: { requestDays: 1 } });
  const song = f.store.records.list(SCOPE, p.id)[0];
  assert.equal(song.data.count, 1);
  assert.deepEqual(song.data.recentDates, ['2026-09-18']);
  assert.deepEqual(song.data.dailyCounts, []);
  assert.ok(f.db.songDb.prepare('SELECT 1 FROM requests WHERE id = ?').get(request.id));
});

test('summary backup restores the full combined notes from multiple valid supplements', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const notes = ['甲'.repeat(1500), '乙'.repeat(1500)];
  for (const note of notes) f.record(p.id, 'song', { songName: '长说明曲目', note });
  const backup = f.run('backup');
  assert.equal(backup.version, 2);
  const saved = backup.profiles[0].records.find((record) => record.kind === 'song');
  assert.equal(saved.data.note, notes.join('\n'));
  f.run('delete', { id: p.id, confirm: true, suppress: false });
  const plan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...plan, conflicts: 'keep' });
  const restored = f.detail(p.id).songs[0];
  assert.equal(restored.data.count, 2);
  assert.equal(restored.data.note, notes.join('\n'));
});

test('clock rollback preserves future daily counts through reads, writes and restore until their dates arrive', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  for (const day of ['17', '18']) f.record(p.id, 'song', { songName: '时钟曲目', category: '国语' },
    { occurredAt: `2026-09-${day}T04:00:00Z` });
  assert.equal(f.detail(p.id).musicStats.count, 2);
  f.setNow('2026-09-16T04:00:00Z');
  assert.equal(f.detail(p.id).musicStats.count, 0);
  assert.deepEqual(f.store.records.list(SCOPE, p.id)[0].data.dailyCounts, [
    { date: '2026-09-17', category: '国语', count: 1 },
    { date: '2026-09-18', category: '国语', count: 1 },
  ]);
  f.record(p.id, 'song', { songName: '时钟曲目', category: '粤语' });
  const backup = f.run('backup');
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'replace' });
  const before = f.detail(p.id);
  assert.equal(before.songs[0].data.count, 3);
  assert.equal(before.songs[0].data.dailyCounts.length, 3);
  assert.equal(before.musicStats.count, 1);
  assert.deepEqual({ ...before.musicStats.categories }, { 粤语: 1 });
  f.setNow(NOW);
  const current = f.detail(p.id);
  assert.equal(current.musicStats.count, 3);
  assert.deepEqual({ ...current.musicStats.categories }, { 国语: 2, 粤语: 1 });
  assert.deepEqual(current.songs[0].data.dailyCounts, before.songs[0].data.dailyCounts);
});
