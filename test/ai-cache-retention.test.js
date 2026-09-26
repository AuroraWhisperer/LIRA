'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createAiConfigStore } = require('../src/ai/config-store');

function fixture(t) {
  let now = 0;
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const createStore = () => createAiConfigStore(db, {}, { now: () => now });
  return {
    db,
    createStore,
    store: createStore(),
    advanceTo(value) { now = value; },
    count(table) { return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count; },
  };
}

for (const hours of [12, 24, 7 * 24]) {
  test(`AI expires never-revisited cache and context across ${hours} virtual hours`, (t) => {
    const f = fixture(t);
    const minutes = hours * 60;
    for (let minute = 0; minute <= minutes; minute += 1) {
      f.advanceTo(minute * 60000);
      f.store.setCache(`unique-query-${minute}`, { text: `reply-${minute}` }, 60);
      f.store.setContext(`unique-viewer-${minute}`, { answer: `reply-${minute}` }, 1200);
    }
    assert.equal(f.count('ai_query_cache'), 1);
    assert.equal(f.count('ai_viewer_context'), 20);
    assert.deepEqual(f.store.getCache(`unique-query-${minutes}`), { text: `reply-${minutes}` });
    assert.deepEqual(f.store.getContext(`unique-viewer-${minutes - 19}`), { answer: `reply-${minutes - 19}` });
    assert.equal(f.store.getContext(`unique-viewer-${minutes - 20}`), null);
  });
}

test('AI first write after restart removes old expiry while preserving live context and business rows', (t) => {
  const f = fixture(t);
  f.store.setCache('expired-query', { text: 'old' }, 60);
  f.store.setContext('expired-viewer', { answer: 'old' }, 60);
  f.store.setContext('live-viewer', { answer: 'retained' }, 86400);
  f.store.setBlacklist('blocked-viewer', true);
  f.store.logRequest({ uid: 'logged-viewer', status: 'generated' });
  f.advanceTo(12 * 60 * 60 * 1000);
  f.createStore().setContext('new-viewer', { answer: 'new' }, 1200);
  assert.equal(f.count('ai_query_cache'), 0);
  assert.equal(f.count('ai_viewer_context'), 2);
  assert.deepEqual(f.store.getContext('live-viewer'), { answer: 'retained' });
  assert.equal(f.store.isBlacklisted('blocked-viewer'), true);
  assert.equal(f.count('ai_request_logs'), 1);
});

test('AI cache cleanup recovers after the system clock moves backwards', (t) => {
  const f = fixture(t);
  f.advanceTo(24 * 60 * 60 * 1000);
  f.store.setCache('future-live', { text: 'future' }, 60);
  f.advanceTo(0);
  f.store.setCache('past-expiring', { text: 'old' }, 60);
  f.advanceTo(60000);
  f.store.setCache('past-live', { text: 'new' }, 60);
  assert.equal(f.count('ai_query_cache'), 2);
  assert.deepEqual(f.store.getCache('future-live'), { text: 'future' });
  assert.deepEqual(f.store.getCache('past-live'), { text: 'new' });
});
