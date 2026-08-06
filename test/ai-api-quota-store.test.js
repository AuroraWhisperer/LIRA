'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createAiApiQuotaStore, API_QUOTAS } = require('../src/ai/api-quota-store');

test('AI API quotas stop exactly at their configured monthly limits', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const quota = createAiApiQuotaStore(db, { now: () => Date.parse('2026-08-06T04:00:00.000Z') });

  for (const [category, limit] of Object.entries(API_QUOTAS)) {
    db.prepare(`
      INSERT INTO ai_api_usage (category, month_key, request_count, updated_at)
      VALUES (?, '2026-08', ?, 0)
    `).run(category, limit - 1);
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

test('quota availability maps exhausted categories to their local tools', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const quota = createAiApiQuotaStore(db, { now: () => Date.parse('2026-08-06T04:00:00.000Z') });
  const insert = db.prepare(`
    INSERT INTO ai_api_usage (category, month_key, request_count, updated_at)
    VALUES (?, '2026-08', ?, 0)
  `);
  insert.run('qweather', API_QUOTAS.qweather);
  insert.run('amap_search', API_QUOTAS.amap_search);
  insert.run('amap_lbs', API_QUOTAS.amap_lbs);

  assert.deepEqual(quota.getExcludedToolNames(), [
    'get_weather', 'search_places', 'resolve_location', 'get_route'
  ]);
  assert.deepEqual(quota.getAllUsage().map((usage) => [usage.category, usage.limit]), [
    ['qweather', 40000], ['amap_search', 4000], ['amap_lbs', 120000]
  ]);
});
