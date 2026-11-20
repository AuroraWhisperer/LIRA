'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { SONG_SCHEMA, runMigrations } = require('../../src/storage/schema');
const { getMigrationPlan } = require('../../src/storage/database-migrations');
const { createFanProfileStore } = require('../../src/storage/fan-profile-store');
const { createFanProfileService } = require('../../src/fans/profile-service');
const { DAY_MS } = require('../../src/fans/dates');

// Set LIRA_BENCH_FAN_LIST=1 for five cold and warm comparisons at 1,000 x 180.
test('dated roster lists match complete history and decode fewer observations, including after a record-only write', (t) => {
  const deep = process.env.LIRA_BENCH_FAN_LIST === '1';
  const count = deep ? 1000 : 3;
  const days = deep ? 180 : 20;
  const scope = 'synthetic';
  const now = () => '2026-11-18T04:00:00.000Z';
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(SONG_SCHEMA);
  const { key, steps } = getMigrationPlan().find(plan => plan.name === 'songDb');
  runMigrations(db, key, steps);
  const store = createFanProfileStore(db);
  const members = Array.from({ length: count }, (_, i) => ({ uid: String(i + 1), name: `fan${i}`, level: 3, medalLevel: 12 }));
  createFanProfileService({ store, now }).importGuardRoster(scope, {
    roomId: '12', ownerUid: '5', observedAt: now(), members, skipped: 0,
  }, '2026-11-18');
  // Replay the importer's real templates at distinct daily instants and source keys.
  const seeds = db.prepare('SELECT id, profile_id, source_key, roster_template_id FROM fan_records WHERE scope=?').all(scope);
  assert.equal(seeds.length, count);
  assert.ok(seeds.every(row => row.roster_template_id));
  const dates = Array.from({ length: days - 1 }, (_, i) => new Date(Date.parse(now()) - (i + 1) * DAY_MS).toISOString());
  store.transaction(() => {
    const insert = db.prepare(`INSERT INTO fan_records(id, scope, profile_id, kind, occurred_at, source_key, data, original, roster_template_id)
      VALUES (?, ?, ?, 'membership', ?, ?, '{}', '{}', ?)`);
    for (const row of seeds) for (const date of dates) {
      insert.run(`${row.id}:${date}`, scope, row.profile_id, date, row.source_key.replace(now(), date), row.roster_template_id);
    }
  });

  function reader(bounded) {
    const sample = {};
    const records = {
      ...store.records,
      listProjectionInputs(scope, ids, before) {
        const started = performance.now();
        const rows = store.records.listProjectionInputs(scope, ids, bounded ? before : undefined);
        sample.readMs = +(performance.now() - started).toFixed(3);
        sample.rows = 0;
        for (const records of rows.values()) sample.rows += records.length;
        return rows;
      },
    };
    const service = createFanProfileService({ now, store: { ...store, records } });
    return () => {
      const started = performance.now();
      const result = service.execute(scope, 'list');
      return { result, timing: { listMs: +(performance.now() - started).toFixed(3), ...sample } };
    };
  }
  const warmFull = reader(false);
  const warmBounded = reader(true);
  assert.deepEqual(warmBounded().result, warmFull().result);
  function compare(label, full, bounded) {
    const expected = full();
    const actual = bounded();
    assert.deepEqual(actual.result, expected.result);
    assert.ok(actual.timing.rows < expected.timing.rows);
    if (deep) t.diagnostic(JSON.stringify({ label, full: expected.timing, bounded: actual.timing }));
    return actual.result;
  }
  for (let round = 0; round < (deep ? 5 : 1); round++) {
    compare('cold', reader(false), reader(true));
    compare('warm', warmFull, warmBounded);
  }
  const id = seeds[0].profile_id;
  store.records.insert(scope, id, { kind: 'followup', occurredAt: now(), data: { reviewDate: '2026-11-18' } });
  const updated = compare('record-only write', warmFull, warmBounded);
  assert.equal(updated.profiles.find(p => p.id === id).nextReminder.date, '2026-11-18');
  assert.equal(store.records.list(scope, id).length, days + 1);
});
