'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createFixture } = require('../helpers/gift-query-fixture');
const { createGiftQueryStore } = require('../../src/storage/gift-query-store');
const { getGiftHistory } = require('../../src/bilibili/gift/query-service');
const { runAllMigrations } = require('../../src/storage/database-migrations');
const schema = require('../../src/storage/schema');

function observe(db) {
  const queries = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    for (const method of ['all', 'get']) {
      const execute = statement[method].bind(statement);
      statement[method] = (...params) => {
        if (/^\s*SELECT/iu.test(sql)) queries.push({ sql, params });
        return execute(...params);
      };
    }
    return statement;
  };
  return { queries, prepare };
}

function createVersionedFixture(t, versions) {
  const runMigrations = schema.runMigrations;
  const limitedMigrations = t.mock.method(schema, 'runMigrations', (db, key, steps) =>
    runMigrations(db, key, steps.slice(0, versions[key] ?? steps.length)),
  );
  try {
    // Build the old schema forwards; rewinding a current version leaves future tables and columns behind.
    return createFixture();
  } finally {
    limitedMigrations.mock.restore();
  }
}

test('LIVE migration preserves an existing v15 queue and enforces a single marker after repeated startup', (t) => {
  const f = createVersionedFixture(t, { song_db: 15 });
  t.after(() => f.close());
  const db = f.databases.songDb;
  db.exec(`INSERT INTO queue (song_name, created_at, updated_at) VALUES ('第一首', '2026-10-14', '2026-10-14'),
    ('第二首', '2026-10-14', '2026-10-14')`);
  const before = db.prepare('SELECT * FROM queue ORDER BY id').all();
  runAllMigrations(f.databases);
  assert.deepEqual(db.prepare('SELECT * FROM queue ORDER BY id').all().map((row) => ({ ...row })),
    before.map((row) => ({ ...row, is_live: 0 })));
  db.prepare('UPDATE queue SET is_live = 1 WHERE id = ?').run(before[0].id);
  runAllMigrations(f.databases);
  assert.equal(db.prepare('SELECT id FROM queue WHERE is_live = 1').get().id, before[0].id);
  assert.throws(() => db.prepare('UPDATE queue SET is_live = 1 WHERE id = ?').run(before[1].id), /UNIQUE/);
});

test('query indexes upgrade without changing rows and migrate idempotently', (t) => {
  const f = createVersionedFixture(t, { song_db: 6, gift_db: 11 });
  t.after(() => f.close());
  const source = f.resolveSource('a'.repeat(64));
  f.insertGift(source.id, 'old');
  const songDb = f.databases.songDb;
  const queueId = songDb.prepare(`INSERT INTO queue (song_name, status, created_at, updated_at)
    VALUES ('old', 'waiting', '2026-09-01', '2026-09-01')`)
    .run().lastInsertRowid;
  songDb.prepare("INSERT INTO requests (queue_id, song_name, created_at) VALUES (?, 'old', '2026-09-01')")
    .run(queueId);
  const gifts = f.giftDb.prepare('SELECT * FROM gift_events').all();
  const requests = songDb.prepare('SELECT * FROM requests').all();
  assert.equal(songDb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_requests_queue_id'").get(), undefined);
  assert.equal(f.giftDb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_gift_events_source_recent'").get(), undefined);
  assert.equal(f.giftDb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'gift_retention_state'").get(), undefined);
  assert.equal(Object.hasOwn(gifts[0], 'remote_final_cursor'), false);
  assert.equal(Object.hasOwn(requests[0], 'fan_recorded'), false);
  runAllMigrations(f.databases);
  runAllMigrations(f.databases);
  assert.deepEqual(f.giftDb.prepare(`SELECT ${Object.keys(gifts[0]).join(', ')} FROM gift_events`).all(), gifts);
  assert.deepEqual(songDb.prepare(`SELECT ${Object.keys(requests[0]).join(', ')} FROM requests`).all(), requests);
  assert.equal(f.giftDb.prepare('SELECT remote_final_cursor FROM gift_events').get().remote_final_cursor, null);
  assert.equal(songDb.prepare('SELECT fan_recorded FROM requests').get().fan_recorded, 0);
  assert.match(
    songDb
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM requests WHERE queue_id = ?')
      .all(1)
      .map((r) => r.detail)
      .join('\n'),
    /idx_requests_queue_id/u,
  );
  const { queries, prepare } = observe(f.giftDb);
  const store = createGiftQueryStore(f.giftDb);
  for (const sourceScope of [{ kind: 'source', sourceId: source.id }, { kind: 'local' }]) {
    queries.length = 0;
    store.listRecent({ sourceScope, limit: 30 });
    const { sql, params } = queries[0];
    const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((r) => r.detail)
      .join('\n');
    assert.match(plan, /idx_gift_events_source_recent/u);
    assert.doesNotMatch(plan, /TEMP B-TREE/u);
  }
});

test('fan cascade indexes upgrade without ANALYZE and preserve scope data', (t) => {
  const f = createVersionedFixture(t, { song_db: 14 });
  t.after(() => f.close());
  const db = f.databases.songDb;
  const profile = db.prepare('INSERT INTO fan_profiles (id, scope, data, updated_at) VALUES (?, ?, ?, ?)');
  const record = db.prepare(`INSERT INTO fan_records
    (id, scope, profile_id, kind, occurred_at, data, original) VALUES (?, ?, ?, 'membership', ?, ?, ?)`);
  const reminder = db.prepare(`INSERT INTO fan_reminder_states
    (scope, profile_id, item_key, data) VALUES (?, ?, 'membership', ?)`);
  for (const scope of ['first', 'second']) {
    for (let i = 0; i < 2; i += 1) {
      const id = `${scope}-${i}`;
      profile.run(id, scope, JSON.stringify({ name: id }), '2026-10-13');
      reminder.run(scope, id, JSON.stringify({ enabled: true }));
      for (let j = 0; j < 2; j += 1) {
        record.run(`${id}-${j}`, scope, id, '2026-10-13', JSON.stringify({ value: j }), '{}');
      }
    }
  }
  const tables = ['fan_profiles', 'fan_records', 'fan_reminder_states'];
  const before = tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  assert.equal(schema.getSchemaVersion(db, 'song_db'), 14);
  runAllMigrations(f.databases);
  runAllMigrations(f.databases);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_stat1'").get(), undefined);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  for (const [i, table] of tables.entries()) {
    assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), before[i]);
  }
  assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'idx_fan_records_profile'").get());
  const plan = db.prepare('EXPLAIN QUERY PLAN DELETE FROM fan_profiles WHERE scope = ?')
    .all('first').map((row) => row.detail).join('\n');
  assert.match(plan, /SEARCH fan_records USING COVERING INDEX idx_fan_records_profile_id \(profile_id=\?\)/u);
  assert.match(plan, /SEARCH fan_reminder_states USING COVERING INDEX idx_fan_reminder_states_profile_id \(profile_id=\?\)/u);
  assert.doesNotMatch(plan, /SCAN fan_(records|reminder_states)/u);
  assert.equal(schema.getSchemaVersion(db, 'song_db'), 16);
  db.prepare('DELETE FROM fan_profiles WHERE scope = ?').run('first');
  for (const [i, table] of tables.entries()) {
    assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      before[i].filter((row) => row.scope === 'second'));
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('retained history upgrades without ANALYZE and seeks both time directions across statuses', (t) => {
  const f = createVersionedFixture(t, { gift_db: 17 });
  t.after(() => f.close());
  const source = f.resolveSource('a'.repeat(64));
  const other = f.resolveSource('b'.repeat(64));
  const detailStart = '2026-09-01T12:00:03.000Z';
  const asOf = '2026-09-02T00:00:00.000Z';
  const expected = [];
  f.giftDb.exec('BEGIN');
  const snapshotId = f.giftDb.prepare(`INSERT INTO gift_retention_snapshots
    (source_id, projection_generation, sync_epoch, revision, base_revision, covered_cursor,
     detail_start, phase, updated_at)
    VALUES (?, 1, 'epoch-1', 1, 0, 0, ?, 'active', ?)`).run(source.id, detailStart, asOf).lastInsertRowid;
  f.giftDb.prepare('UPDATE gift_retention_snapshots SET member_snapshot_id = ? WHERE id = ?')
    .run(snapshotId, snapshotId);
  f.giftDb.prepare('INSERT INTO gift_retention_state (source_id, active_snapshot_id) VALUES (?, ?)')
    .run(source.id, snapshotId);
  for (let i = 0; i < 540; i += 1) {
    const createdAt = new Date(Date.parse('2026-09-01T12:00:00.000Z') + Math.floor(i / 6) * 1000).toISOString();
    const status = ['active', 'retention-staged', 'hidden'][i % 3];
    const detectionStatus = i % 17 === 0 ? 'progress' : 'final';
    const { lastInsertRowid: id } = f.insertGift(source.id, `event-${i}`, { createdAt, status, detectionStatus });
    f.insertGift(other.id, `other-${i}`, { createdAt, status });
    if (i % 7 === 0) f.giftDb.prepare('DELETE FROM gift_retention_members WHERE event_id = ?').run(id);
    if (i % 7 !== 0 && status !== 'hidden' && detectionStatus === 'final' && createdAt >= detailStart) {
      expected.push({ id: Number(id), created_at: createdAt });
    }
  }
  f.giftDb.exec('COMMIT');
  const originalRows = f.giftDb.prepare('SELECT * FROM gift_events ORDER BY id').all();
  const originalMembers = f.giftDb.prepare('SELECT * FROM gift_retention_members ORDER BY event_id').all();
  runAllMigrations(f.databases);
  runAllMigrations(f.databases);
  assert.deepEqual(f.giftDb.prepare('SELECT * FROM gift_events ORDER BY id').all(), originalRows);
  assert.deepEqual(f.giftDb.prepare('SELECT * FROM gift_retention_members ORDER BY event_id').all(), originalMembers);
  assert.equal(f.giftDb.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_stat1'").get(), undefined);
  const { queries, prepare } = observe(f.giftDb);
  const store = createGiftQueryStore(f.giftDb);
  for (const sortDirection of ['asc', 'desc']) {
    const sorted = [...expected].sort((a, b) =>
      (sortDirection === 'asc' ? 1 : -1) * a.created_at.localeCompare(b.created_at) || b.id - a.id);
    const actual = [];
    let cursor;
    queries.length = 0;
    while (true) {
      const rows = store.listHistory({ sourceId: source.id, asOf, sortDirection, cursor, limit: 4 });
      actual.push(...rows.map((row) => row.id));
      if (!rows.length) break;
      cursor = { sortValue: rows.at(-1).history_sort_value, id: rows.at(-1).id };
    }
    assert.deepEqual(actual, sorted.map((row) => row.id));
    const historyQueries = queries.filter(({ sql }) => /SELECT g\.\*/u.test(sql));
    assert.ok(historyQueries.some(({ sql }) => /g\.created_at = \?/u.test(sql)));
    assert.ok(historyQueries.some(({ sql }) => /g\.created_at [<>] \?/u.test(sql)));
    for (const { sql, params } of historyQueries) {
      const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join('\n');
      assert.match(plan, /SEARCH g USING INDEX .*source_id=\?.*created_at/u);
      assert.doesNotMatch(plan, /TEMP B-TREE/u);
    }
  }
});

for (const sortDirection of ['asc', 'desc']) {
  test(`time history ${sortDirection} seeks both boundaries and preserves equal-time ordering`, (t) => {
    const f = createFixture();
    t.after(() => f.close());
    const source = f.resolveSource('a'.repeat(64));
    f.setActiveSource(source.id);
    for (let i = 0; i < 17; i += 1)
      f.insertGift(source.id, `event-${i}`, {
        createdAt: `2026-09-01T12:00:0${Math.floor(i / 6)}.000Z`,
      });
    const expected = f.giftDb
      .prepare(`SELECT platform_id FROM gift_events ORDER BY created_at ${sortDirection}, id DESC`)
      .all()
      .map((r) => r.platform_id.slice(12));
    const { queries, prepare } = observe(f.giftDb);
    const ids = [];
    let cursor;
    do {
      const page = getGiftHistory(f.context, { range: 'all', limit: 4, sortDirection, cursor });
      ids.push(...page.items.map((item) => item.eventId));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, expected);
    const boundaryQueries = queries.filter(({ sql }) => /g\.created_at = \?/u.test(sql));
    assert.ok(boundaryQueries.length > 0);
    const rangeQueries = queries.filter(({ sql }) => /AND g\.created_at [<>] \?/u.test(sql));
    assert.ok(rangeQueries.length > 0);
    for (const { sql, params } of [...boundaryQueries, ...rangeQueries]) {
      assert.doesNotMatch(sql, /OR \(g\.created_at/u);
      const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params)
        .map((r) => r.detail)
        .join('\n');
      assert.match(plan, /SEARCH.*created_at/u);
      assert.doesNotMatch(plan, /TEMP B-TREE/u);
    }
    const store = createGiftQueryStore(f.giftDb);
    const options = {
      sourceId: source.id,
      asOf: '2026-09-02T00:00:00.000Z',
      sortDirection,
      cursor: { sortValue: '2026-09-01T12:00:01.000Z', id: 12 },
      limit: 2,
    };
    queries.length = 0;
    assert.equal(store.listHistory(options).length, 2);
    assert.equal(queries.filter(({ sql }) => /FROM gift_events g/u.test(sql)).length, 1,
      'full equal-time segment must not query the next range (retention metadata is a separate lookup)');
    assert.deepEqual(
      store.listHistory({
        ...options,
        cursor: {
          sortValue: sortDirection === 'asc' ? '2026-09-01T23:00:00.000Z' : '2026-09-01T00:00:00.000Z',
          id: 1,
        },
      }),
      [],
    );
  });
}

test('history count cache follows data versions, source and filters, including external writes and rollback', (t) => {
  const f = createFixture();
  t.after(() => f.close());
  const source = f.resolveSource('a'.repeat(64));
  const other = f.resolveSource('b'.repeat(64));
  f.setActiveSource(source.id);
  for (let i = 0; i < 6; i += 1) f.insertGift(source.id, `event-${i}`);
  f.insertGift(other.id, 'other');
  const { queries } = observe(f.giftDb);
  const read = (options = {}) => getGiftHistory(f.context, { range: 'all', limit: 2, ...options });
  const counts = () => queries.filter(({ sql }) => /COUNT\(\*\) AS count/u.test(sql)).length;
  const first = read();
  assert.equal(read({ cursor: first.nextCursor }).total, 6);
  assert.equal(counts(), 1);
  assert.equal(read({ query: '无匹配' }).total, 0);
  f.setActiveSource(other.id);
  assert.equal(read().total, 1);
  f.setActiveSource(source.id);
  f.insertGift(source.id, 'late', { createdAt: '2026-08-01T00:00:00.000Z' });
  assert.equal(read({ cursor: first.nextCursor }).total, 7);
  const filename = f.giftDb
    .prepare('PRAGMA database_list')
    .all()
    .find((r) => r.name === 'main').file;
  const external = new DatabaseSync(filename);
  try {
    external
      .prepare('DELETE FROM gift_events WHERE source_id = ? AND platform_id = ?')
      .run(source.id, 'lira-server:late');
  } finally {
    external.close();
  }
  assert.equal(read().total, 6);
  f.giftDb.exec('BEGIN');
  f.giftDb.prepare("UPDATE gift_events SET status = 'hidden' WHERE source_id = ?").run(source.id);
  f.giftDb.exec('ROLLBACK');
  assert.equal(read().total, 6);
  f.giftDb.prepare('DELETE FROM gift_events WHERE source_id = ?').run(source.id);
  assert.equal(read().total, 0);
});

test('both time segments and cached total share one snapshot during an external commit', (t) => {
  const f = createFixture();
  let external;
  t.after(() => {
    external?.close();
    f.close();
  });
  const source = f.resolveSource('a'.repeat(64));
  f.setActiveSource(source.id);
  for (let i = 0; i < 7; i += 1)
    f.insertGift(source.id, `event-${i}`, {
      createdAt: `2026-09-01T12:00:0${Math.floor(i / 3)}.000Z`,
    });
  const first = getGiftHistory(f.context, { range: 'all', limit: 2 });
  const filename = f.giftDb
    .prepare('PRAGMA database_list')
    .all()
    .find((r) => r.name === 'main').file;
  external = new DatabaseSync(filename);
  const prepare = f.giftDb.prepare.bind(f.giftDb);
  let changed = false;
  f.giftDb.prepare = (sql) => {
    const statement = prepare(sql);
    if (/AND g\.created_at = \?/u.test(sql)) {
      const all = statement.all.bind(statement);
      statement.all = (...params) => {
        const rows = all(...params);
        external.prepare('DELETE FROM gift_events WHERE source_id = ?').run(source.id);
        changed = true;
        return rows;
      };
    }
    return statement;
  };
  const page = getGiftHistory(f.context, { range: 'all', limit: 3, cursor: first.nextCursor });
  assert.equal(changed, true);
  assert.equal(page.total, 7);
  assert.deepEqual(
    page.items.map((item) => item.eventId),
    ['event-4', 'event-3', 'event-2'],
  );
  assert.equal(getGiftHistory(f.context, { range: 'all' }).total, 0);
});

test('count cache is bounded and failed pages do not publish counts', (t) => {
  const f = createFixture();
  t.after(() => f.close());
  const source = f.resolveSource('a'.repeat(64));
  f.insertGift(source.id, 'one');
  const { queries } = observe(f.giftDb);
  const store = createGiftQueryStore(f.giftDb);
  const options = { sourceId: source.id, asOf: '2026-09-02T00:00:00.000Z', limit: 2 };
  assert.throws(() => store.readHistoryPage({ ...options, limit: 'invalid' }));
  queries.length = 0;
  assert.equal(store.readHistoryPage(options).total, 1);
  assert.equal(queries.filter(({ sql }) => /COUNT\(\*\)/u.test(sql)).length, 1);
  for (let i = 0; i < 64; i += 1) store.readHistoryPage({ ...options, query: `query-${i}` });
  queries.length = 0;
  store.readHistoryPage(options);
  assert.equal(queries.filter(({ sql }) => /COUNT\(\*\)/u.test(sql)).length, 1);
});

test('recent expression index preserves legacy timestamp, zone and same-second ID order', (t) => {
  const f = createFixture();
  t.after(() => f.close());
  const source = f.resolveSource('a'.repeat(64));
  for (const [i, createdAt] of [
    '2026-09-01T04:00:00.900Z',
    '2026-09-01 04:00:00',
    '2026-09-01T12:00:00+08:00',
    '2026-09-01T04:00:01.000Z',
  ].entries())
    f.insertGift(source.id, `time-${i}`, { createdAt });
  const rows = createGiftQueryStore(f.giftDb).listRecent({
    sourceScope: { kind: 'source', sourceId: source.id },
    limit: 30,
  });
  assert.deepEqual(
    rows.map((row) => row.platform_id),
    ['time-3', 'time-2', 'time-1', 'time-0'].map((id) => `lira-server:${id}`),
  );
});
