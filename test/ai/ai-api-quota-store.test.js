'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiApiQuotaStore, API_QUOTAS, withApiQuota } = require('../../src/ai/api-quota-store');

test('AI API quotas stop exactly at their configured monthly limits', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const quota = createAiApiQuotaStore(db, {
    now: () => Date.parse('2026-08-06T04:00:00.000Z'),
  });

  for (const [category, limit] of Object.entries(API_QUOTAS)) {
    db.prepare(
      `
      INSERT INTO ai_api_usage (category, month_key, request_count, updated_at)
      VALUES (?, '2026-08', ?, 0)
    `,
    ).run(category, limit - 1);
    assert.equal(quota.consume(category).allowed, true);
    assert.equal(quota.consume(category).allowed, false);
    assert.equal(quota.getUsage(category).requestCount, limit);
  }
});

test('AI API quotas reset at the start of a Beijing calendar month', () => {
  let now = Date.parse('2026-08-31T15:59:59.000Z');
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const quota = createAiApiQuotaStore(db, { now: () => now });

  assert.equal(quota.consume('qweather').monthKey, '2026-08');
  now = Date.parse('2026-08-31T16:00:00.000Z');
  assert.equal(quota.getUsage('qweather').requestCount, 0);
  assert.equal(quota.consume('qweather').monthKey, '2026-09');
});

test('failed requests consume the remaining monthly quota and block the next attempt', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  const quota = createAiApiQuotaStore(db, {
    now: () => Date.parse('2026-08-06T04:00:00.000Z'),
  });
  db.prepare('INSERT INTO ai_api_usage (category, month_key, request_count, updated_at) VALUES (?, ?, ?, 0)')
    .run('qweather', '2026-08', API_QUOTAS.qweather - 1);

  let attempts = 0;
  const sendRequest = async () => {
    attempts += 1;
    throw new Error('response lost after dispatch');
  };
  await assert.rejects(withApiQuota(quota, 'qweather', sendRequest), /response lost/);
  assert.equal(quota.getUsage('qweather').requestCount, API_QUOTAS.qweather);
  await assert.rejects(
    withApiQuota(quota, 'qweather', sendRequest),
    (error) => error.code === 'QWEATHER_MONTHLY_LIMIT',
  );
  assert.equal(attempts, 1);
});

test('a late failure after month rollover keeps both months of request counts intact', async (t) => {
  let now = Date.parse('2026-08-31T15:59:59.000Z');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  const quota = createAiApiQuotaStore(db, { now: () => now });
  let rejectRequest;
  const request = withApiQuota(quota, 'qweather', () => new Promise((resolve, reject) => {
    rejectRequest = reject;
  }));
  const rejection = assert.rejects(request, /late timeout/);

  now = Date.parse('2026-08-31T16:00:00.000Z');
  quota.consume('qweather');
  rejectRequest(new Error('late timeout'));
  await rejection;

  const rows = db.prepare('SELECT month_key, request_count FROM ai_api_usage ORDER BY month_key').all();
  assert.deepEqual(rows.map((row) => [row.month_key, row.request_count]), [['2026-08', 1], ['2026-09', 1]]);
});

test('quota availability maps exhausted categories to their local tools', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const quota = createAiApiQuotaStore(db, {
    now: () => Date.parse('2026-08-06T04:00:00.000Z'),
  });
  const insert = db.prepare(`
    INSERT INTO ai_api_usage (category, month_key, request_count, updated_at)
    VALUES (?, '2026-08', ?, 0)
  `);
  insert.run('qweather', API_QUOTAS.qweather);
  insert.run('amap_search', API_QUOTAS.amap_search);
  insert.run('amap_lbs', API_QUOTAS.amap_lbs);

  assert.deepEqual(quota.getExcludedToolNames(), ['get_weather', 'search_places', 'resolve_location', 'get_route']);
  assert.deepEqual(
    quota.getAllUsage().map((usage) => [usage.category, usage.limit]),
    [
      ['qweather', 40000],
      ['amap_search', 4000],
      ['amap_lbs', 120000],
    ],
  );
});

test('quota cleanup keeps current, previous and future months across year rollover and clock rollback', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  const insert = db.prepare('INSERT INTO ai_api_usage VALUES (?, ?, ?, 0)');
  for (const month of ['2025-11', '2025-12', '2026-01', '2026-02']) {
    insert.run('qweather', month, API_QUOTAS.qweather);
  }
  let now = Date.parse('2025-12-31T16:00:00Z');
  const quota = createAiApiQuotaStore(db, { now: () => now });
  const months = () => db.prepare('SELECT month_key FROM ai_api_usage ORDER BY month_key').all().map((row) => row.month_key);
  assert.deepEqual(months(), ['2025-12', '2026-01', '2026-02']);
  assert.equal(quota.consume('qweather').allowed, false, 'cleanup must not reset the current budget');
  now = Date.parse('2025-12-31T15:59:59Z');
  assert.equal(quota.consume('qweather').allowed, false, 'a recent clock rollback still sees its budget');
  assert.deepEqual(months(), ['2025-12', '2026-01', '2026-02']);
  now = Date.parse('2026-01-31T16:00:00Z');
  assert.equal(quota.consume('qweather').allowed, false);
  assert.deepEqual(months(), ['2026-01', '2026-02']);
});
