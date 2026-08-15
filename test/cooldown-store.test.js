'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCooldownStore, COOLDOWN_RETENTION_MS } = require('../src/storage/cooldown-store');

test('cooldown Map pruning removes expired entries and keeps fresh entries', () => {
  const store = createCooldownStore({});
  const now = Date.parse('2026-08-15T00:00:00.000Z');
  const map = new Map([
    ['expired', now - COOLDOWN_RETENTION_MS - 1],
    ['fresh', now - 1]
  ]);

  assert.equal(store.pruneMap(map, now), 1);
  assert.deepEqual([...map.keys()], ['fresh']);
});
