'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createFixture } = require('./helpers/gift-query-fixture');
const { fanFixture, SCOPE } = require('./helpers/fan-profile-fixture');
const { createGiftQueryStore } = require('../src/storage/gift-query-store');
const { getGiftHistory } = require('../src/bilibili/gift/query-service');
const { runAllMigrations } = require('../src/storage/database-migrations');

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

test('query indexes upgrade without changing rows and migrate idempotently', (t) => {
  const f = createFixture();
  t.after(() => f.close());
  const source = f.resolveSource('a'.repeat(64));
  f.insertGift(source.id, 'old');
  const songDb = f.databases.songDb;
  songDb.exec("INSERT INTO requests (song_name, created_at) VALUES ('old', '2026-09-01')");
  const gifts = f.giftDb.prepare('SELECT * FROM gift_events').all();
  const requests = songDb.prepare('SELECT * FROM requests').all();
  songDb.exec('DROP INDEX IF EXISTS idx_requests_queue_id');
  f.giftDb.exec(
    'DROP INDEX IF EXISTS idx_gift_events_source_recent; DROP INDEX IF EXISTS idx_gift_events_source_time_asc',
  );
  songDb.prepare('UPDATE schema_version SET version = 6 WHERE key = ?').run('song_db');
  f.giftDb.prepare('UPDATE schema_version SET version = 11 WHERE key = ?').run('gift_db');
  runAllMigrations(f.databases);
  runAllMigrations(f.databases);
  assert.deepEqual(f.giftDb.prepare('SELECT * FROM gift_events').all(), gifts);
  assert.deepEqual(songDb.prepare('SELECT * FROM requests').all(), requests);
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
    assert.equal(queries.length, 1, 'full equal-time segment must not query the next range');
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

test('fan list loads only candidates and batches full lists without changing record order or scope', (t) => {
  const f = fanFixture(t);
  const ids = [];
  f.store.transaction(() => {
    for (let i = 0; i < 503; i += 1) {
      const p = f.store.save(
        SCOPE,
        {
          alias: `观众-${i}`,
          tags: ['中文'],
          favorite: i === 502,
          archived: false,
          summary: '',
          milestoneReminders: false,
        },
        null,
        '2026-09-18T04:00:00.000Z',
      );
      ids.push(p.id);
      for (const id of ['z', 'a'])
        f.store.records.insert(SCOPE, p.id, {
          id: `${p.id}-${id}`,
          kind: 'note',
          occurredAt: '2026-09-17T04:00:00.000Z',
          data: { text: id },
        });
      f.store.saveState(SCOPE, p.id, 'handled', { status: 'handled' });
    }
  });
  const { queries } = observe(f.db.songDb);
  const selected = f.run('list', { query: '观众-502' }).profiles;
  assert.equal(selected.length, 1);
  const recordsQueries = () => queries.filter(({ sql }) => /FROM fan_records/u.test(sql));
  assert.equal(recordsQueries().length, 1);
  assert.ok(recordsQueries()[0].params.includes(ids[502]));
  assert.ok(!recordsQueries()[0].params.includes(ids[0]));
  queries.length = 0;
  assert.equal(f.run('list', { filters: ['favorite'] }).profiles.length, 1);
  assert.equal(recordsQueries().length, 1);
  queries.length = 0;
  assert.equal(f.run('list', { query: '找不到' }).profiles.length, 0);
  assert.equal(recordsQueries().length, 0);
  queries.length = 0;
  assert.equal(f.run('list').profiles.length, 503);
  assert.equal(recordsQueries().length, 2);
  assert.equal(queries.filter(({ sql }) => /FROM fan_reminder_states/u.test(sql)).length, 2);
  const batch = f.store.records.listForProfiles(SCOPE, ids);
  assert.deepEqual(batch.get(ids[0]), f.store.records.list(SCOPE, ids[0]));
  assert.equal(f.store.records.listForProfiles('other', ids).size, 0);
  assert.deepEqual(f.store.statesForProfiles(SCOPE, ids).get(ids[0]), f.store.states(SCOPE, ids[0]));
  assert.equal(f.store.statesForProfiles('other', ids).size, 0);
});
