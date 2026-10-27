'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_TABLE_SCHEMA } = require('../../src/storage/schema');
const { createCooldownStore, COOLDOWN_RETENTION_MS } = require('../../src/storage/cooldown-store');
const { createUserRequestCooldown } = require('../../src/music/user-request-cooldown');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_TABLE_SCHEMA);
  t.after(() => db.close());
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T00:00:00Z') });
  const store = createCooldownStore(db);
  return { db, store, cooldown: createUserRequestCooldown(store) };
}

test('restore retains recent timestamps and reset clears memory without deleting persisted records', (t) => {
  const { store, cooldown } = fixture(t);
  const at = Date.now();
  store.touch('old', { at: at - COOLDOWN_RETENTION_MS - 1 });
  store.touch('42', { at: at - 1000 });
  store.touch('open_id:42', { at });
  assert.equal(cooldown.restore(), 2);
  assert.equal(cooldown.getLastRequestAt('old'), 0);
  assert.equal(cooldown.getLastRequestAt('42'), at - 1000);
  assert.equal(cooldown.getLastRequestAt('open_id:42'), at);
  cooldown.reset();
  assert.equal(cooldown.getLastRequestAt('42'), 0);
  assert.equal(cooldown.restore(), 2);
  assert.equal(cooldown.getLastRequestAt('42'), at - 1000);
});

test('refreshing a key keeps older keys at the head so expiry can prune them', (t) => {
  const { store, cooldown } = fixture(t);
  const at = Date.now();
  store.touch('refresh', { at: at - COOLDOWN_RETENTION_MS + 10 });
  store.touch('expire', { at: at - COOLDOWN_RETENTION_MS + 20 });
  cooldown.restore();
  cooldown.recordAccepted('refresh', { uid: '1', userName: '观众' });
  t.mock.timers.tick(21);
  assert.equal(cooldown.getLastRequestAt('expire'), 0);
  assert.equal(cooldown.getLastRequestAt('refresh'), at);
});

test('future persisted timestamps are ignored and pruned instead of extending cooldowns', (t) => {
  const { db, store, cooldown } = fixture(t);
  const at = Date.now();
  store.touch('future', { at: at + 365 * 24 * 60 * 60 * 1000 });
  store.touch('fresh', { at: at - 1000 });
  assert.equal(cooldown.restore(), 1);
  assert.equal(cooldown.getLastRequestAt('future'), 0);
  assert.equal(cooldown.getLastRequestAt('fresh'), at - 1000);
  assert.equal(store.prune(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_cooldowns WHERE user_key = 'future'").get().count, 0);
});

test('a clock rollback cannot make an already restored timestamp produce negative elapsed time', (t) => {
  const { store, cooldown } = fixture(t);
  const at = Date.now();
  store.touch('42', { at });
  cooldown.restore();
  t.mock.method(Date, 'now', () => at - 1000);
  assert.equal(cooldown.getLastRequestAt('42'), 0);
});

test('persistence failure retains the accepted timestamp in memory and emits a warning', (t) => {
  const { db, cooldown } = fixture(t);
  db.exec(`CREATE TEMP TRIGGER fail_cooldown BEFORE INSERT ON user_cooldowns
    BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END`);
  const warning = t.mock.method(console, 'warn', () => {});
  assert.doesNotThrow(() => cooldown.recordAccepted('42', { uid: '42', userName: '观众' }));
  assert.equal(cooldown.getLastRequestAt('42'), Date.now());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_cooldowns').get().count, 0);
  assert.match(warning.mock.calls[0].arguments[0], /key=42.*synthetic write failure/);
});
