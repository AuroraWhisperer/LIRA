'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDanmakuAppearanceStore, migrateDanmakuAppearance } = require('../../src/storage/danmaku-appearance-store');
const { createDanmakuAppearance } = require('../../src/server/danmaku-appearance');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { migrateTestSongDb } = require('../helpers/song-database');
const { trackBodyReads } = require('../helpers/sqlite-body-reads');

function fixture(t, loadLegacy = async () => ({ style: 'bubble', fullscreenDurationSeconds: 9 })) {
  const db = new DatabaseSync(':memory:');
  migrateTestSongDb(db);
  const store = createDanmakuAppearanceStore(db);
  const state = { owner: { scope: '["https://example.test","streamer-a"]', epoch: 1 }, changes: 0 };
  const service = createDanmakuAppearance({ store, getOwner: () => state.owner, loadLegacy,
    onChanged: () => state.changes++ });
  t.after(() => db.close());
  return { db, store, state, service };
}

test('queue activity and another owner’s writes do not transfer the cached appearance in either direction', async t => {
  const f = fixture(t);
  const { config } = await f.service.read();
  const size = Buffer.byteLength(JSON.stringify(config));
  const reads = trackBodyReads(t, f.db, 'config_json');
  const store = createDanmakuAppearanceStore(f.db);
  const addRequest = f.db.prepare("INSERT INTO queue (song_name, created_at, updated_at) VALUES ('song', 'test', 'test')");
  for (let n = 0; n < 60; n++) {
    addRequest.run();
    f.store.set('account-b', { n });
    const copy = store.get(f.state.owner.scope);
    assert.equal(copy.style, config.style);
    copy.style = 'caller mutation';
  }
  assert.equal(reads.returnedBytes, size);
  assert.ok(reads.largestBind < size, 'cache checks must not bind the configuration');
});

test('appearance cache follows same-connection and external repairs, rollback and whole-row replacement', t => {
  const directory = createScratchDirectory('danmaku-appearance-');
  const filename = path.join(directory, 'appearance.sqlite');
  const db = new DatabaseSync(filename);
  const other = new DatabaseSync(filename);
  t.after(() => { other.close(); db.close(); removeScratchDirectory(directory); });
  migrateTestSongDb(db);
  const reads = trackBodyReads(t, db, 'config_json');
  const store = createDanmakuAppearanceStore(db);
  store.set('owner', { style: 'bubble' });
  const style = () => store.get('owner')?.style;
  assert.equal(style(), 'bubble');
  const coldBytes = reads.returnedBytes;
  other.exec("INSERT INTO queue (song_name, created_at, updated_at) VALUES ('external song', 'test', 'test')");
  assert.equal(style(), 'bubble');
  assert.equal(reads.returnedBytes, coldBytes);
  const repair = db.prepare("UPDATE danmaku_appearances SET config_json = ? WHERE owner_scope = 'owner'");
  db.exec('BEGIN');
  repair.run('{"style":"signal"}');
  assert.equal(style(), 'signal');
  db.exec('ROLLBACK');
  assert.equal(style(), 'bubble');
  repair.run('{"style":"notebook"}');
  assert.equal(style(), 'notebook');
  const priorToken = db.prepare("SELECT body_token FROM danmaku_appearances WHERE owner_scope = 'owner'").get().body_token;
  other.exec(`UPDATE danmaku_appearances SET config_json = '{"style":"spooky"}' WHERE owner_scope = 'owner'`);
  // A second repair writes the same JSON with a token from an older backup.
  other.prepare("UPDATE danmaku_appearances SET config_json = config_json, body_token = ? WHERE owner_scope = 'owner'").run(priorToken);
  assert.equal(style(), 'spooky');
  other.exec(`CREATE TEMP TABLE restored AS SELECT * FROM danmaku_appearances;
    UPDATE restored SET config_json = '{"style":"astral"}';
    INSERT OR REPLACE INTO danmaku_appearances SELECT * FROM restored;`);
  assert.equal(style(), 'astral');
  other.exec("DELETE FROM danmaku_appearances WHERE owner_scope = 'owner'");
  assert.equal(store.get('owner'), null);
});

test('legacy settings initialize once; local profiles survive repeated migrations and service recreation', async t => {
  let reads = 0;
  const f = fixture(t, async () => { reads++; return { style: 'bubble', fullscreenDurationSeconds: 9,
    overlayUrl: 'PRIVATE', token: 'PRIVATE', styleOptions: { bubble: { fontSize: 32 } } }; });
  const initial = await f.service.read();
  assert.equal(initial.config.style, 'bubble');
  assert.equal(initial.config.styleOptions.bubble.fontSize, 32);
  assert.doesNotMatch(JSON.stringify(initial), /PRIVATE/);
  const next = { ...initial, config: { ...initial.config, style: 'spooky' } };
  f.service.save(next);
  assert.equal(f.service.seed({ ownerScope: f.state.owner.scope, authorizationEpoch: 1,
    settings: { style: 'signal', fullscreenDurationSeconds: 6 } }), false);
  migrateDanmakuAppearance(f.db);
  const restartedStore = createDanmakuAppearanceStore(f.db);
  const restarted = createDanmakuAppearance({ store: restartedStore, getOwner: () => f.state.owner,
    loadLegacy: () => { throw new Error('Existing local appearance must not read the server.'); } });
  assert.deepEqual(await restarted.read(), next);
  assert.equal(reads, 1);
  assert.equal(f.state.changes, 2);
});

test('local appearance restores the selected style, edited region and per-style effects after restart', async t => {
  const f = fixture(t);
  const initial = await f.service.read();
  const config = structuredClone(initial.config);
  config.style = 'horizontal-charm';
  config.layout.regions['horizontal-charm'] = { x: 100, y: 600, width: 1100, height: 140 };
  config.styleOptions['horizontal-charm'] = { charmGap: 44 };
  config.styleParameters = {
    'horizontal-charm': { transform: { rotateY: -12, perspective: 1400 } },
    stardust: { showEntryMessages: false, textOutline: { color: '#203040', width: 1.5 }, shadow: { opacity: 60, blur: 4 } },
  };
  f.service.save({ binding: initial.binding, config: structuredClone(config) });
  const restarted = createDanmakuAppearance({ store: createDanmakuAppearanceStore(f.db), getOwner: () => f.state.owner });
  const restored = (await restarted.read()).config;
  assert.equal(restored.style, config.style);
  assert.deepEqual(restored.layout.regions['horizontal-charm'], config.layout.regions['horizontal-charm']);
  assert.deepEqual(restored.styleOptions, config.styleOptions);
  assert.partialDeepStrictEqual(restored.styleParameters, config.styleParameters);
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
