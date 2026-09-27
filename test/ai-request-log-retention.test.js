'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-defaults');
const { applyRetentionPolicies, readRetentionPolicy } = require('../src/storage/retention');
const { createAiConfigStore } = require('../src/ai/config-store');
const { runStartupRetention } = require('../src/server/startup-retention');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 26, 12);

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const songDb = new DatabaseSync(':memory:');
  songDb.exec(SONG_SCHEMA);
  t.after(() => songDb.close());
  let timestamp = NOW;
  const store = createAiConfigStore(songDb, {}, { now: () => timestamp });
  return {
    songDb,
    store,
    logAt(time, uid) {
      timestamp = time;
      store.logRequest({ uid, status: 'generated' });
      timestamp = NOW;
    },
    run(options) {
      return applyRetentionPolicies({ songDb }, options);
    },
    remaining() {
      return songDb
        .prepare('SELECT uid FROM ai_request_logs ORDER BY id')
        .all()
        .map((row) => row.uid);
    },
  };
}

test('AI audit retention defaults to 30 days and normalizes the persisted setting', () => {
  assert.equal(DEFAULT_SETTINGS.aiRequestLogRetentionDays, '30');
  for (const value of [undefined, 'invalid', '-1', Infinity]) {
    assert.equal(readRetentionPolicy({ aiRequestLogRetentionDays: value }).aiRequestLogDays, 30);
  }
  assert.equal(readRetentionPolicy({ aiRequestLogRetentionDays: '7.9' }).aiRequestLogDays, 7);
  assert.equal(readRetentionPolicy({ aiRequestLogRetentionDays: '0' }).aiRequestLogDays, 0);
});

test('AI audit dry-run and deletion agree at the millisecond cutoff and are idempotent', (t) => {
  const f = fixture(t);
  const cutoff = NOW - 30 * DAY_MS;
  f.logAt(NOW - 60 * DAY_MS, 'old');
  f.logAt(cutoff - 1, 'just-expired');
  f.logAt(cutoff, 'boundary');
  f.logAt(NOW, 'current');
  f.logAt(NOW + DAY_MS, 'future');

  const preview = f.run({ dryRun: true });
  assert.equal(preview.aiRequestLogsDeleted, 2);
  assert.equal(f.remaining().length, 5);
  const actual = f.run();
  assert.equal(actual.aiRequestLogsDeleted, preview.aiRequestLogsDeleted);
  assert.deepEqual(f.remaining(), ['boundary', 'current', 'future']);
  assert.equal(f.run().aiRequestLogsDeleted, 0);
});

test('AI audit retention honors configured days and zero disables deletion', (t) => {
  const f = fixture(t);
  f.logAt(NOW - 60 * DAY_MS, 'old');
  f.logAt(NOW - 8 * DAY_MS, 'last-week');
  f.logAt(NOW - DAY_MS, 'recent');
  const disabled = readRetentionPolicy({ aiRequestLogRetentionDays: '0' });
  assert.equal(f.run({ policy: disabled }).aiRequestLogsDeleted, 0);
  assert.equal(f.remaining().length, 3);
  const weekly = readRetentionPolicy({ aiRequestLogRetentionDays: '7' });
  assert.equal(f.run({ policy: weekly }).aiRequestLogsDeleted, 2);
  assert.deepEqual(f.remaining(), ['recent']);
});

test('AI audit retention does not delete configuration, blacklist, quota, cache or context', (t) => {
  const f = fixture(t);
  f.logAt(NOW - 60 * DAY_MS, 'expired');
  f.store.setBlacklist('blocked', true);
  f.store.setCache('query', { text: 'cached' }, 600);
  f.store.setContext('viewer', { answer: 'context' }, 600);
  f.songDb
    .prepare('INSERT INTO ai_configuration (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)')
    .run('deepseekApiKey', 'synthetic-secret', 1, new Date(NOW - 60 * DAY_MS).toISOString());
  f.songDb
    .prepare('INSERT INTO ai_api_usage (category, month_key, request_count, updated_at) VALUES (?, ?, ?, ?)')
    .run('chat', '2026-07', 3, NOW - 60 * DAY_MS);
  const tables = ['ai_configuration', 'ai_blacklist', 'ai_api_usage', 'ai_query_cache', 'ai_viewer_context'];
  const snapshot = () => tables.map((table) => f.songDb.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot();
  assert.equal(f.run().aiRequestLogsDeleted, 1);
  assert.deepEqual(snapshot(), before);
});

test('startup retention reports AI-only deletions through the configured policy', (t) => {
  const f = fixture(t);
  f.logAt(NOW - 8 * DAY_MS, 'expired');
  const log = t.mock.method(console, 'log', () => {});
  const settings = { autoRetentionOnStartup: 'true', aiRequestLogRetentionDays: '7' };
  runStartupRetention(
    { getSettings: () => settings },
    {
      runRetention: () => f.run({ policy: readRetentionPolicy(settings) }),
    },
  );
  assert.deepEqual(f.remaining(), []);
  assert.equal(log.mock.callCount(), 1);
  assert.match(log.mock.calls[0].arguments[0], /aiRequests=1/);
});

test('AI audit retention tolerates an absent song database', () => {
  assert.equal(applyRetentionPolicies({}).aiRequestLogsDeleted, 0);
});
