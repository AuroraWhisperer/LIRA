'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createDanmakuAppearanceStore, migrateDanmakuAppearance } = require('../../src/storage/danmaku-appearance-store');
const { createDanmakuAppearance } = require('../../src/server/danmaku-appearance');

function fixture(t, loadLegacy = async () => ({ style: 'bubble', fullscreenDurationSeconds: 9 })) {
  const db = new DatabaseSync(':memory:');
  migrateDanmakuAppearance(db);
  const store = createDanmakuAppearanceStore(db);
  const state = { owner: { scope: '["https://example.test","streamer-a"]', epoch: 1 }, changes: 0 };
  const service = createDanmakuAppearance({ store, getOwner: () => state.owner, loadLegacy,
    onChanged: () => state.changes++ });
  t.after(() => db.close());
  return { db, store, state, service };
}

test('legacy settings initialize once; local profiles survive repeated migrations and service recreation', async t => {
  let reads = 0;
  const f = fixture(t, async () => { reads++; return { style: 'bubble', fullscreenDurationSeconds: 9,
    overlayUrl: 'PRIVATE', token: 'PRIVATE', styleOptions: { bubble: { fontSize: 32 } } }; });
  const initial = await f.service.read();
  assert.equal(initial.config.style, 'bubble');
  assert.equal(initial.config.styleOptions.bubble.fontSize, 32);
  assert.doesNotMatch(JSON.stringify(initial), /PRIVATE/);
  const next = { ...initial, config: { ...initial.config, style: 'spooky',
    styleOptions: { ...initial.config.styleOptions, spooky: { fontSize: 36 }, outline: { durationSeconds: 12 } } } };
  f.service.save(next);
  assert.equal(f.service.seed({ ownerScope: f.state.owner.scope, authorizationEpoch: 1,
    settings: { style: 'signal', fullscreenDurationSeconds: 6 } }), false);
  migrateDanmakuAppearance(f.db);
  const restarted = createDanmakuAppearance({ store: createDanmakuAppearanceStore(f.db), getOwner: () => f.state.owner,
    loadLegacy: () => { throw new Error('Existing local appearance must not read the server.'); } });
  assert.deepEqual(await restarted.read(), next);
  assert.equal(reads, 1);
  assert.equal(f.state.changes, 2);
});

test('invalid local writes leave the complete saved appearance unchanged', async t => {
  const f = fixture(t);
  const initial = await f.service.read();
  for (const patch of [{ style: 'unknown' }, { styleOptions: { signal: { fontSize: 10000 } } },
    { fullscreenDurationSeconds: 31 }, { token: 'PRIVATE' }, { layout: { canvas: { width: -1 } } }]) {
    assert.throws(() => f.service.save({ ...initial, config: { ...initial.config, ...patch } }));
    assert.deepEqual(await f.service.read(), initial);
  }
  assert.equal(f.state.changes, 1);
});

test('owner changes and reauthorization reject stale drafts without affecting either account', async t => {
  const f = fixture(t);
  const first = await f.service.read();
  f.service.save({ ...first, config: { ...first.config, style: 'spooky' } });
  f.state.owner = { scope: 'account-b', epoch: 2 };
  assert.throws(() => f.service.save(first), { code: 'DANMAKU_OWNER_CHANGED' });
  assert.equal(f.service.getSettings(), null);
  assert.equal((await f.service.read()).config.style, 'bubble');
  f.state.owner = { scope: '["https://example.test","streamer-a"]', epoch: 3 };
  assert.equal((await f.service.read()).config.style, 'spooky');
  assert.throws(() => f.service.save(first), { code: 'DANMAKU_OWNER_CHANGED' });
  f.state.owner = null;
  assert.equal(f.service.getSettings(), null);
  await assert.rejects(f.service.read(), { code: 'LICENSE_NOT_AUTHORIZED' });
});

test('concurrent initialization shares one read and never writes a late response to a new account', async t => {
  let resolve;
  let reads = 0;
  const f = fixture(t, () => { reads++; return new Promise(done => { resolve = done; }); });
  const first = f.service.read();
  const second = f.service.read();
  f.state.owner = { scope: 'account-b', epoch: 2 };
  resolve({ style: 'bubble', fullscreenDurationSeconds: 9 });
  await assert.rejects(first, { code: 'DANMAKU_OWNER_CHANGED' });
  await assert.rejects(second, { code: 'DANMAKU_OWNER_CHANGED' });
  assert.equal(reads, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM danmaku_appearances').get().count, 0);
});

test('failed initialization can retry without writing defaults over the old configuration', async t => {
  let failed = true;
  const f = fixture(t, async () => failed ? { ok: false, error: 'NETWORK_UNAVAILABLE' }
    : { style: 'notebook', fullscreenDurationSeconds: 6 });
  await assert.rejects(f.service.read(), { code: 'DANMAKU_MIGRATION_UNAVAILABLE' });
  assert.equal(f.service.getSettings(), null);
  failed = false;
  assert.equal((await f.service.read()).config.style, 'notebook');
});
