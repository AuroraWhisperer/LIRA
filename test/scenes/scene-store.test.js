'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets, migrateSceneDeletion } = require('../../src/storage/scene-migration');
const { createSceneStore } = require('../../src/storage/scene-store');
const { createDatabases, closeDatabases, getSchemaVersions } = require('../../src/storage/database');
const { runAllMigrations } = require('../../src/storage/database-migrations');
const { SCENE_TYPES, SHARED_SCENE_TYPES } = require('../../src/shared/scene-component-types');
const { createScratchDirectory } = require('../helpers/scratch-directory');

function document(title = '场景') {
  return { schemaVersion: 1, id: randomUUID(), title, canvas: { width: 1920, height: 1080 }, items: [] };
}

function capability(version = 1) {
  return { version, hash: String(version).repeat(64), encrypted: `ciphertext-${version}` };
}

function fixture(t) {
  const directory = createScratchDirectory('scene-store-');
  const filename = path.join(directory, 'scenes.sqlite');
  const connections = new Set();
  const open = () => {
    const connection = new DatabaseSync(filename);
    connections.add(connection);
    return connection;
  };
  const close = (connection) => {
    connection.close();
    connections.delete(connection);
  };
  t.after(() => {
    for (const connection of connections) connection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const db = open();
  migrateScenes(db);
  migrateComponentOutputSizes(db);
  migrateCanvasPresets(db); migrateSceneDeletion(db);
  return { db, open, close, store: createSceneStore(db) };
}

test('songDb scene migrations preserve v7 rows and are idempotent after restart', (t) => {
  const directory = createScratchDirectory('scene-store-');
  let databases = createDatabases({ dataDir: directory });
  t.after(() => {
    closeDatabases(databases);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const db = databases.songDb;
  db.exec(`
    DROP TABLE component_scenes;
    UPDATE schema_version SET version = 7 WHERE key = 'song_db';
    INSERT INTO requests (song_name, created_at) VALUES ('keep this request', '2026-09-30');
  `);
  const before = db.prepare('SELECT * FROM requests').all();
  const result = runAllMigrations(databases);
  assert.deepEqual(result.find((entry) => entry.key === 'song_db'), { key: 'song_db', from: 7, to: 11, applied: 4 });
  const store = createSceneStore(db);
  const created = store.create({ scope: 'server/account', document: document(), capability: capability() });
  migrateScenes(db);
  assert.equal(runAllMigrations(databases).find((entry) => entry.key === 'song_db').applied, 0);
  assert.deepEqual(db.prepare('SELECT * FROM requests').all(), before);
  closeDatabases(databases);
  databases = createDatabases({ dataDir: directory });
  assert.equal(getSchemaVersions(databases).songDb, 11);
  assert.deepEqual(databases.songDb.prepare('SELECT * FROM requests').all(), before);
  assert.deepEqual(createSceneStore(databases.songDb).get('server/account', created.document.id), created);
});

test('v11 upgrades a populated v10 canvas without changing documents or credentials and can run repeatedly', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  migrateScenes(db); migrateComponentOutputSizes(db); migrateCanvasPresets(db);
  const store = createSceneStore(db);
  const created = store.create({ scope: 'owner', document: document(), capability: capability() });
  const binding = store.bindCanvas('owner', created.document.id);
  store.publish({ scope: 'owner', id: created.document.id, expectedRevision: 1, document: created.document });
  const before = store.get('owner', created.document.id);
  migrateSceneDeletion(db);
  migrateSceneDeletion(db);
  assert.deepEqual(store.list('owner'), [before]);
  assert.deepEqual(store.getCanvas('owner'), binding);
  db.prepare('UPDATE component_canvas SET active_scene_id = NULL WHERE owner_scope = ?').run('owner');
  assert.equal(store.getCanvas('owner').activeSceneId, null);
});

test('v10 binds the previously first scene without rewriting drafts or credentials and remains stable after new presets', t => {
  const { db, store } = fixture(t);
  const first = { ...document('Existing'), id: '22222222-2222-4222-8222-222222222222' };
  store.create({ scope: 'owner', document: first, capability: capability() });
  const before = store.get('owner', first.id);
  migrateCanvasPresets(db); migrateSceneDeletion(db);
  assert.deepEqual(store.bindCanvas('owner', first.id), { outputId: first.id, activeSceneId: first.id });
  const next = { ...document('New'), id: '11111111-1111-4111-8111-111111111111' };
  store.create({ scope: 'owner', document: next, capability: capability() });
  migrateCanvasPresets(db); migrateSceneDeletion(db);
  assert.equal(store.bindCanvas('owner', next.id).outputId, first.id);
  assert.deepEqual(store.get('owner', first.id), before);
  assert.equal(store.bindCanvas('another-owner', first.id), null);
});

test('v9 upgrades an existing v8 database and atomically publishes default dimensions', (t) => {
  const directory = createScratchDirectory('scene-store-');
  const databases = createDatabases({ dataDir: directory });
  t.after(() => { closeDatabases(databases); fs.rmSync(directory, { recursive: true, force: true }); });
  const db = databases.songDb;
  const store = createSceneStore(db);
  const original = store.create({ scope: 'owner', document: document(), capability: capability() });
  db.exec("DROP TABLE component_output_sizes; UPDATE schema_version SET version = 8 WHERE key = 'song_db'");
  assert.deepEqual(runAllMigrations(databases).find((entry) => entry.key === 'song_db'),
    { key: 'song_db', from: 8, to: 11, applied: 3 });
  migrateComponentOutputSizes(db);
  migrateCanvasPresets(db); migrateSceneDeletion(db);
  assert.deepEqual(store.get('owner', original.document.id), original);
  const input = { scope: 'owner', id: original.document.id, expectedRevision: 1, document: original.document,
    componentSizes: { clock: { width: 800, height: 400 } } };
  store.publish(input);
  const published = store.get('owner', input.id);
  db.exec(`CREATE TRIGGER fail_component_size BEFORE UPDATE ON component_output_sizes
    BEGIN SELECT RAISE(ABORT, 'synthetic size failure'); END;`);
  assert.throws(() => store.publish({ ...input, componentSizes: { clock: { width: 900, height: 500 } } }));
  assert.deepEqual(store.get('owner', input.id), published);
  assert.deepEqual(store.getComponentSize('owner', 'clock'), { width: 800, height: 400 });
  assert.equal(store.getComponentSize('other-owner', 'clock'), null);
});

test('persisted default sizes accept shared component types and reject independent, control or unknown types atomically', (t) => {
  const { store } = fixture(t);
  const initial = store.create({ scope: 'owner', document: document(), capability: capability() });
  const input = { scope: 'owner', id: initial.document.id, expectedRevision: 1, document: initial.document,
    componentSizes: Object.fromEntries(SHARED_SCENE_TYPES.map((type) => [type, { width: 800, height: 400 }])) };
  store.publish(input);
  const published = store.get('owner', input.id);
  for (const type of SHARED_SCENE_TYPES) {
    assert.deepEqual(store.getComponentSize('owner', type), { width: 800, height: 400 }, type);
  }
  for (const type of [...SCENE_TYPES.filter((type) => !SHARED_SCENE_TYPES.includes(type)), 'canvas', 'unknown', 'constructor']) {
    assert.throws(() => store.publish({ ...input, componentSizes: { [type]: { width: 800, height: 400 } } }),
      /CHECK constraint failed/);
    assert.deepEqual(store.get('owner', input.id), published);
    assert.equal(store.getComponentSize('owner', type), null);
  }
});

test('SQLite restart preserves separate draft, publication and capability', (t) => {
  const { store, db, open, close } = fixture(t);
  const initial = store.create({ scope: 'owner-a', document: document(), capability: capability() });
  const id = initial.document.id;
  const publication = { ...initial.document, title: 'published' };
  store.publish({ scope: 'owner-a', id, expectedRevision: 1, document: publication });
  store.save({ scope: 'owner-a', id, expectedRevision: 1, document: { ...initial.document, title: 'draft only' } });
  store.rotate({ scope: 'owner-a', id, expectedCapabilityVersion: 1, capability: capability(2) });
  close(db);
  const reopened = open();
  const record = createSceneStore(reopened).get('owner-a', id);
  assert.equal(record.revision, 2);
  assert.equal(record.document.title, 'draft only');
  assert.deepEqual(record.publishedDocument, publication);
  assert.equal(record.publishedVersion, 1);
  assert.deepEqual(record.capability, capability(2));
});

test('independent SQLite connections use optimistic revision and capability checks', (t) => {
  const { store, open } = fixture(t);
  const anotherDb = open();
  const other = createSceneStore(anotherDb);
  const initial = store.create({ scope: 'owner', document: document(), capability: capability() });
  const id = initial.document.id;
  const stale = other.get('owner', id);
  const saved = store.save({ scope: 'owner', id, expectedRevision: 1, document: { ...initial.document, title: 'winner' } });
  assert.equal(saved.revision, 2);
  assert.equal(other.save({ scope: 'owner', id, expectedRevision: stale.revision, document: stale.document }), null);
  assert.equal(other.publish({ scope: 'owner', id, expectedRevision: 1, document: stale.document }), null);
  const published = other.publish({ scope: 'owner', id, expectedRevision: 2, document: saved.document });
  assert.equal(published.publishedVersion, 1);
  assert.equal(published.revision, 2);
  assert.equal(store.publish({ scope: 'owner', id, expectedRevision: 2, document: saved.document }).publishedVersion, 2);
  store.rotate({ scope: 'owner', id, expectedCapabilityVersion: 1, capability: capability(2) });
  assert.equal(other.rotate({ scope: 'owner', id, expectedCapabilityVersion: 1, capability: capability(3) }), null);
  assert.deepEqual(other.get('owner', id).capability, capability(2));
});

test('every store read and mutation is owner scoped', (t) => {
  const { store } = fixture(t);
  const initial = store.create({ scope: 'owner-a', document: document(), capability: capability() });
  const id = initial.document.id;
  store.create({ scope: 'owner-b', document: document('other'), capability: capability() });
  assert.equal(store.list('owner-a').length, 1);
  assert.equal(store.get('owner-b', id), null);
  const mutation = { scope: 'owner-b', id, expectedRevision: 1, document: initial.document };
  assert.equal(store.save(mutation), null);
  assert.equal(store.publish(mutation), null);
  assert.equal(store.delete(mutation), null);
  assert.equal(store.rotate({ ...mutation, expectedCapabilityVersion: 1, capability: capability(2) }), null);
  assert.deepEqual(store.get('owner-a', id), initial);
});

test('preset deletion checks the latest revision and canvas binding inside SQLite', t => {
  const { store, db } = fixture(t);
  const first = store.create({ scope: 'owner', document: document(), capability: capability() });
  const extra = store.create({ scope: 'owner', document: document('Extra'), capability: capability() });
  store.bindCanvas('owner', first.document.id);
  const input = { scope: 'owner', id: extra.document.id, expectedRevision: 1,
    expectedCanvas: { outputId: first.document.id, activeSceneId: first.document.id, publishedVersion: 0 } };
  assert.equal(store.delete({ ...input, id: first.document.id, expectedCanvas: undefined }), null);
  db.prepare('UPDATE component_canvas SET active_scene_id = ? WHERE owner_scope = ?').run(input.id, input.scope);
  assert.equal(store.delete(input), null);
  db.prepare('UPDATE component_canvas SET active_scene_id = ? WHERE owner_scope = ?').run(first.document.id, input.scope);
  store.save({ ...input, document: extra.document });
  assert.equal(store.delete(input), null);
  store.publish({ scope: 'owner', id: first.document.id, expectedRevision: 1, document: first.document });
  assert.equal(store.delete({ ...input, expectedRevision: 2 }), null, 'A concurrent output publication invalidates the deletion snapshot.');
  input.expectedCanvas.publishedVersion = 1;
  assert.deepEqual(store.delete({ ...input, expectedRevision: 2 }), { id: input.id });
  assert.equal(store.get(input.scope, input.id), null);
  assert.deepEqual(store.get('owner', first.document.id).document, first.document);
});

test('failed SQLite publication and capability rotation leave the complete prior row intact', (t) => {
  const { store, db } = fixture(t);
  const initial = store.create({ scope: 'owner', document: document(), capability: capability() });
  const id = initial.document.id;
  store.publish({ scope: 'owner', id, expectedRevision: 1, document: initial.document });
  const before = store.get('owner', id);
  db.exec(`
    CREATE TRIGGER fail_publication AFTER UPDATE OF published_json ON component_scenes
    BEGIN SELECT RAISE(ABORT, 'synthetic publication failure'); END;
    CREATE TRIGGER fail_capability AFTER UPDATE OF capability_hash ON component_scenes
    BEGIN SELECT RAISE(ABORT, 'synthetic rotation failure'); END;
  `);
  assert.throws(() => store.publish({ scope: 'owner', id, expectedRevision: 1, document: { ...initial.document, title: 'new' } }));
  assert.deepEqual(store.get('owner', id), before);
  assert.throws(() => store.rotate({ scope: 'owner', id, expectedCapabilityVersion: 1, capability: capability(2) }));
  assert.deepEqual(store.get('owner', id), before);
  assert.throws(() => store.save({ scope: 'owner', id, expectedRevision: 1, document: { ...initial.document, title: '界'.repeat(262144) } }));
  assert.deepEqual(store.get('owner', id), before);
});
