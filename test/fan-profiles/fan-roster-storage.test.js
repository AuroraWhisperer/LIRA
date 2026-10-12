'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA, runMigrations, getSchemaVersion } = require('../../src/storage/schema');
const { migrateFanProfiles } = require('../../src/storage/fan-profile-migration');
const { migrateFanRosterObservations } = require('../../src/storage/fan-roster-observation-migration');
const { createFanRecordStore } = require('../../src/storage/fan-record-store');
const { recordData } = require('../../src/fans/validation');
const { prepareMembership } = require('../../src/fans/membership');
const { buildReminders } = require('../../src/fans/reminders');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');

function observation(observedAt, level = 3) {
  const data = recordData('membership', {
    type: 'observation', level, observedAt,
    reason: '自动同步房间 1234 的大航海名单；仅确认同步时的等级，起止日期待补充。',
  });
  data.cycleId = 'fixture-cycle';
  return {
    kind: 'membership', occurredAt: observedAt,
    sourceKey: `guard-roster:1234:${IDENTITY.value}:${observedAt}:${level}:`,
    data,
    original: { ...data, source: 'platform', evidence: 'guard-roster', roomId: '1234', ownerUid: '99', medalLevel: null, identity: IDENTITY },
  };
}

function oldDatabase(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SONG_SCHEMA);
  migrateFanProfiles(db);
  db.prepare('INSERT INTO fan_profiles (id, scope, data, updated_at) VALUES (?, ?, ?, ?)')
    .run('profile', SCOPE, '{}', NOW);
  runMigrations(db, 'song_db', Array(13).fill(null));
  return db;
}

function upgrade(db) {
  return runMigrations(db, 'song_db', [...Array(13).fill(null), migrateFanRosterObservations]);
}

function sync(f, observedAt, scope = SCOPE) {
  f.service.importGuardRoster(scope, {
    roomId: '1234', ownerUid: '99', observedAt,
    members: [{ uid: IDENTITY.value, name: '海边听歌', level: 3 }], skipped: 0,
  }, observedAt.slice(0, 10));
}

function templateCount(db, scope = SCOPE) {
  return db.prepare('SELECT COUNT(*) n FROM fan_roster_templates WHERE scope = ?').get(scope).n;
}

test('v14 preserves every observation and historical result while storing repeated evidence once', (t) => {
  const db = oldDatabase(t);
  const records = createFanRecordStore(db);
  const dates = ['2026-09-16T04:00:00.000Z', '2026-09-18T04:00:00.000Z', '2026-09-21T04:00:00.000Z'];
  for (const date of dates) records.insert(SCOPE, 'profile', observation(date));
  records.insert(SCOPE, 'profile', observation('2026-09-23T04:00:00.000Z', 2));
  const data = recordData('membership', { type: 'interval', precision: 'instant', startAt: '2026-09-15T04:00:00Z', endAt: '2026-09-19T04:00:00Z', level: 3 });
  records.insert(SCOPE, 'profile', { kind: 'membership', data, occurredAt: NOW });
  const before = records.list(SCOPE, 'profile');
  const profile = { id: 'profile', alias: '小海', expiryReminders: true };
  const states = [{ key: `expiry:${before.find((record) => record.data.type === 'interval').id}`, status: 'ignored' }];
  const asOf = ['2026-09-16T03:59:59Z', ...dates, '2026-09-19T04:00:00Z', '2026-09-21T03:59:59Z', '2026-09-23T04:00:00Z'];
  const oldSummary = prepareMembership(before);
  const expected = asOf.map((at) => ({ membership: oldSummary(at), reminders: buildReminders(profile, before, states, Date.parse(at)) }));
  assert.equal(upgrade(db).applied, 1);
  assert.equal(getSchemaVersion(db, 'song_db'), 14);
  const store = createFanRecordStore(db);
  const after = store.list(SCOPE, 'profile');
  assert.deepEqual(after, before);
  assert.deepEqual(store.listForProfiles(SCOPE, ['profile']).get('profile'), before);
  assert.equal(templateCount(db), 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fan_records WHERE data = '{}' AND original = '{}' AND roster_template_id IS NOT NULL").get().n, 4);
  assert.equal(store.bySource(SCOPE, before[0].sourceKey)?.id, before[0].id);
  const newSummary = prepareMembership(after);
  assert.deepEqual(asOf.map((at) => ({ membership: newSummary(at), reminders: buildReminders(profile, after, states, Date.parse(at)) })), expected);
  assert.equal(newSummary('2026-09-19T04:00:00Z').status, 'expired');
  assert.equal(newSummary('2026-09-21T04:00:00Z').status, 'unknown');
  assert.equal(upgrade(db).applied, 0);
  db.exec('BEGIN');
  migrateFanRosterObservations(db);
  db.exec('COMMIT');
  assert.deepEqual(store.list(SCOPE, 'profile'), before);
  assert.equal(templateCount(db), 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('only pristine automatic observations compact; decisions, revisions, manual facts and purchases stay intact', (t) => {
  const db = oldDatabase(t);
  const records = createFanRecordStore(db);
  const cases = [
    (record) => { record.data.reason = record.original.reason = '手动同步房间 1234 的大航海名单；仅确认同步时的等级，起止日期待补充。'; },
    (record) => { record.data.decision = record.original.decision = 'rejected'; },
    (record) => { record.data.decision = record.original.decision = 'pending'; },
    (record) => { record.data.decision = record.original.decision = 'superseded'; },
    (record) => { record.data.excluded = record.original.excluded = true; },
    (record) => { record.revision = 2; record.revisions = [{ source: 'manual', before: { data: record.data } }]; },
    (record) => { record.data.level = 2; },
    (record) => { record.original.evidence = 'guard-purchase'; },
  ];
  for (const [index, change] of cases.entries()) {
    const record = observation(`2026-09-${String(index + 10).padStart(2, '0')}T04:00:00.000Z`);
    change(record);
    records.insert(SCOPE, 'profile', record);
  }
  const before = records.list(SCOPE, 'profile');
  upgrade(db);
  assert.equal(templateCount(db), 0);
  assert.deepEqual(createFanRecordStore(db).list(SCOPE, 'profile'), before);
});

test('manual correction expands one record and retains original evidence, references and remaining shared data', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  sync(f, NOW);
  sync(f, '2026-09-19T04:00:00.000Z');
  const before = f.store.records.list(SCOPE, p.id);
  assert.equal(templateCount(f.db.songDb), 1);
  const old = before[0];
  const result = f.record(p.id, 'membership', { ...old.data, level: 2, reason: '人工核对原始等级' }, { id: old.id, revision: old.revision });
  assert.deepEqual(result.original, old.original);
  assert.deepEqual(result.revisions[0].before, { data: old.data, occurredAt: old.occurredAt });
  assert.equal(result.sourceKey, old.sourceKey);
  assert.equal(result.revision, 2);
  assert.equal(f.db.songDb.prepare('SELECT roster_template_id FROM fan_records WHERE id = ?').get(old.id).roster_template_id, null);
  assert.deepEqual(f.store.records.bySource(SCOPE, before[1].sourceKey), before[1]);
  assert.equal(templateCount(f.db.songDb), 1);
  f.record(p.id, 'membership', { ...before[1].data, excluded: true }, { id: before[1].id, revision: before[1].revision });
  assert.equal(templateCount(f.db.songDb), 0);
  f.restart();
  assert.deepEqual(f.store.records.bySource(SCOPE, old.sourceKey), result);
});

test('saving an identical record keeps its revision and compact storage while stale revisions still fail', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  sync(f, NOW);
  const record = f.store.records.list(SCOPE, p.id)[0];
  const input = { ...record, data: Object.fromEntries(Object.entries(record.data).reverse()) };
  assert.deepEqual(f.store.records.update(SCOPE, p.id, input, '2026-09-19T04:00:00.000Z'), record);
  assert.deepEqual(f.store.records.list(SCOPE, p.id), [record]);
  assert.ok(f.db.songDb.prepare('SELECT roster_template_id FROM fan_records WHERE id = ?').get(record.id).roster_template_id);
  assert.equal(templateCount(f.db.songDb), 1);
  assert.throws(() => f.store.records.update(SCOPE, p.id, { ...input, revision: 0 }, NOW), /记录已更新/);
});

test('expanded v1/v2 backups and recovery snapshots restore compact observations and handled reminder state', (t) => {
  const f = fanFixture(t);
  const p = f.create({ birthday: { monthDay: '09-18' } });
  sync(f, NOW);
  sync(f, '2026-09-19T04:00:00.000Z');
  f.run('reminder-state', { profileId: p.id, key: 'birthday:2026', status: 'handled' });
  const backup = f.run('backup');
  assert.equal(backup.version, 2);
  assert.ok(backup.profiles[0].records.every((record) => record.original.observedAt && !Object.hasOwn(record, 'roster_template_id')));
  for (const version of [1, 2]) {
    f.run('delete', { id: p.id, confirm: true, suppress: false });
    assert.equal(templateCount(f.db.songDb), 0);
    const input = { ...backup, version };
    f.run('restore', { backup: input, ...f.run('preview-restore', { backup: input }), conflicts: 'keep' });
    assert.deepEqual(f.run('backup').profiles[0].records, backup.profiles[0].records);
    assert.equal(templateCount(f.db.songDb), 1);
    assert.equal(f.detail(p.id).reminders.find((item) => item.key === 'birthday:2026').status, 'handled');
  }
  const snapshotId = f.store.snapshot(SCOPE, backup, NOW);
  f.run('delete', { id: p.id, confirm: true, suppress: false });
  f.run('restore-snapshot', { snapshotId, confirm: true, ...f.run('preview-restore', { backup: f.store.getSnapshot(SCOPE, snapshotId) }) });
  assert.deepEqual(f.run('backup').profiles[0].records, backup.profiles[0].records);
  assert.equal(templateCount(f.db.songDb), 1);
});

test('merge retains observation IDs and deletes templates only after their final scoped owner is removed', (t) => {
  const f = fanFixture(t);
  const source = f.create();
  sync(f, NOW);
  const before = f.store.records.list(SCOPE, source.id);
  const unbound = f.run('save', { id: source.id, revision: f.detail(source.id).revision, identity: null });
  const target = f.create();
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  f.create({}, otherScope);
  sync(f, NOW, otherScope);
  const result = f.run('merge', { id: unbound.id, revision: unbound.revision, targetId: target.id, targetRevision: target.revision, prefer: 'target' });
  assert.deepEqual(result.profile.records, before.map((record) => ({ ...record, profileId: target.id })));
  assert.equal(templateCount(f.db.songDb), 1);
  assert.equal(templateCount(f.db.songDb, otherScope), 1);
  f.run('delete', { id: target.id, confirm: true, suppress: false });
  assert.equal(templateCount(f.db.songDb), 0);
  assert.equal(templateCount(f.db.songDb, otherScope), 1);
  f.store.removeAll(otherScope);
  assert.equal(templateCount(f.db.songDb, otherScope), 0);
  assert.deepEqual(f.db.songDb.prepare('PRAGMA foreign_key_check').all(), []);
});

test('failed source removal rolls back v14 schema, evidence and version and permits retry', (t) => {
  const db = oldDatabase(t);
  const records = createFanRecordStore(db);
  records.insert(SCOPE, 'profile', observation(NOW));
  const expected = records.list(SCOPE, 'profile');
  const before = db.prepare('SELECT * FROM fan_records').all();
  db.exec("CREATE TRIGGER fail_roster_conversion BEFORE UPDATE OF data ON fan_records BEGIN SELECT RAISE(ABORT, 'fixture refuses source deletion'); END");
  assert.throws(() => upgrade(db), /fixture refuses source deletion/);
  assert.equal(getSchemaVersion(db, 'song_db'), 13);
  assert.deepEqual(db.prepare('SELECT * FROM fan_records').all(), before);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'fan_roster_templates'").get(), undefined);
  assert.ok(!db.prepare('PRAGMA table_info(fan_records)').all().some((column) => column.name === 'roster_template_id'));
  db.exec('DROP TRIGGER fail_roster_conversion');
  assert.equal(upgrade(db).applied, 1);
  assert.equal(templateCount(db), 1);
  assert.deepEqual(createFanRecordStore(db).list(SCOPE, 'profile'), expected);
});
