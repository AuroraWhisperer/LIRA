'use strict';

// Synthetic disk databases only; run before and after changes with the same script.
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { createFixture } = require('../test/helpers/gift-query-fixture');
const { createGiftQueryStore } = require('../src/storage/gift-query-store');
const { getGiftHistory } = require('../src/bilibili/gift/query-service');
const { createFanProfileStore } = require('../src/storage/fan-profile-store');
const { createFanProfileService } = require('../src/fans/profile-service');

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/benchmark-client-queries.js <output.json>');
const fixture = createFixture();
const at = '2026-09-01T12:00:00.000Z';
const scope = 'synthetic-benchmark';
const traces = [];
function trace(db) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    for (const method of ['all', 'get']) {
      const execute = statement[method].bind(statement);
      statement[method] = (...params) => {
        if (/^\s*SELECT/iu.test(sql)) traces.push({ sql, params });
        return execute(...params);
      };
    }
    return statement;
  };
  return prepare;
}
function measure(operation) {
  const samples = [];
  const counts = [];
  for (let i = 0; i < 31; i += 1) {
    traces.length = 0;
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
    counts.push(traces.length);
  }
  const firstMs = samples.shift();
  const sorted = [...samples].sort((a, b) => a - b);
  return { firstMs, samplesMs: samples, p50Ms: sorted[14], p95Ms: sorted[28], selectCounts: counts };
}
try {
  const source = fixture.resolveSource('a'.repeat(64));
  fixture.setActiveSource(source.id);
  fixture.giftDb.exec('BEGIN');
  for (let i = 0; i < 100000; i += 1) {
    fixture.insertGift(source.id, `bench-${i}`, {
      giftId: `gift-${i % 20}`,
      giftName: `礼物 ${i % 20}`,
      createdAt: new Date(Date.parse(at) - Math.floor(i / 10) * 1000).toISOString(),
    });
  }
  fixture.giftDb.exec('COMMIT');
  const songDb = fixture.databases.songDb;
  const profiles = createFanProfileStore(songDb);
  profiles.transaction(() => {
    for (let i = 0; i < 1000; i += 1) {
      const profile = profiles.save(
        scope,
        {
          alias: `用户-${i}`,
          tags: [],
          summary: '',
          archived: false,
          milestoneReminders: false,
          expiryReminders: false,
        },
        null,
        at,
      );
      for (let j = 0; j < 50; j += 1)
        profiles.records.insert(scope, profile.id, {
          kind: 'note',
          occurredAt: at,
          data: { text: `合成记录-${j}` },
        });
    }
    const insert = songDb.prepare("INSERT INTO requests (queue_id, song_name, created_at) VALUES (?, 'synthetic', ?)");
    for (let i = 0; i < 100000; i += 1) insert.run(null, at);
  });
  const prepareGift = trace(fixture.giftDb);
  const prepareSong = trace(songDb);
  const store = createGiftQueryStore(fixture.giftDb);
  const options = { sourceId: source.id, asOf: '2026-09-02T00:00:00.000Z', limit: 51 };
  const results = {};
  const plans = {};
  for (const direction of ['desc', 'asc']) {
    results[`deep-${direction}`] = measure(() =>
      store.listHistory({
        ...options,
        sortDirection: direction,
        cursor: { sortValue: '2026-09-01T10:36:40.000Z', id: 50001 },
      }),
    );
    plans[`deep-${direction}`] = traces.map(({ sql, params }) => ({
      sql,
      params,
      plan: prepareGift(`EXPLAIN QUERY PLAN ${sql}`).all(...params),
    }));
  }
  results.recent = measure(() =>
    store.listRecent({ sourceScope: { sql: 'source_id = ?', params: [source.id] }, limit: 30 }),
  );
  plans.recent = traces.map(({ sql, params }) => ({
    sql,
    params,
    plan: prepareGift(`EXPLAIN QUERY PLAN ${sql}`).all(...params),
  }));
  results.historyPage = measure(() => getGiftHistory(fixture.context, { range: 'all', limit: 50 }));
  results.count = measure(() => store.countHistory(options));
  const fans = createFanProfileService({ store: profiles, now: () => at });
  results.fanSearch = measure(() => fans.execute(scope, 'list', { query: '用户-999' }));
  results.queue = measure(() => songDb.prepare('SELECT * FROM requests WHERE queue_id = ?').all(-1));
  plans.queue = prepareSong('EXPLAIN QUERY PLAN SELECT * FROM requests WHERE queue_id = ?').all(-1);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const report = {
    environment: {
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0].model,
      memoryBytes: os.totalmem(),
      node: process.version,
      sqlite: prepareGift('SELECT sqlite_version() AS version').get().version,
      database: 'temporary disk database, host default temp volume',
      journalMode: prepareGift('PRAGMA journal_mode').get(),
      synchronous: prepareGift('PRAGMA synchronous').get(),
      cacheSize: prepareGift('PRAGMA cache_size').get(),
      commit: git('rev-parse', 'HEAD'),
      relevantDiff: git(
        'diff',
        '--',
        'src/storage/database-migrations.js',
        'src/storage/gift-query-store.js',
        'src/bilibili/gift/query-service.js',
        'src/fans/profile-service.js',
        'src/storage/fan-record-store.js',
        'src/storage/fan-profile-store.js',
      ),
    },
    fixture: {
      gifts: 100000,
      profiles: 1000,
      fanRecords: 50000,
      requests: 100000,
      seed: 'deterministic counter, no randomness in query data',
      fixedTime: at,
      equalTimestampGroup: 10,
      warmSamples: 30,
      coldDefinition: 'first query after insertion; OS cache is not flushed',
      limitations:
        'No Electron event-loop or Device/monitor/network measurement; queue uses a missing key among NULL links.',
    },
    results,
    plans,
  };
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(results).map(([key, value]) => [
          key,
          { p50Ms: value.p50Ms, p95Ms: value.p95Ms, selectCounts: value.selectCounts.slice(0, 2) },
        ]),
      ),
    ),
  );
} finally {
  fixture.close();
}
