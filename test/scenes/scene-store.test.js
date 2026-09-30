'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { migrateScenes } = require('../../src/storage/scene-migration');
const { createSceneStore } = require('../../src/storage/scene-store');
const { createDatabases, closeDatabases, getSchemaVersions } = require('../../src/storage/database');
const { runAllMigrations } = require('../../src/storage/database-migrations');

function temporaryDirectory() {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'scene-store-'));
}

function document(title = '场景') {
  return { schemaVersion: 1, id: randomUUID(), title, canvas: { width: 1920, height: 1080 }, items: [] };
}

function capability(version = 1) {
  return { version, hash: String(version).repeat(64), encrypted: `ciphertext-${version}` };
}

function fixture(t) {
  const directory = temporaryDirectory();
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
  return { db, open, close, store: createSceneStore(db) };
}

test('songDb v8 migration preserves v7 rows and is idempotent after restart', (t) => {
  const directory = temporaryDirectory();
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
  assert.deepEqual(result.find((entry) => entry.key === 'song_db'), { key: 'song_db', from: 7, to: 8, applied: 1 });
  const store = createSceneStore(db);
  const created = store.create({ scope: 'server/account', document: document(), capability: capability() });
  migrateScenes(db);
  assert.equal(runAllMigrations(databases).find((entry) => entry.key === 'song_db').applied, 0);
  assert.deepEqual(db.prepare('SELECT * FROM requests').all(), before);
  closeDatabases(databases);
  databases = createDatabases({ dataDir: directory });
  assert.equal(getSchemaVersions(databases).songDb, 8);
  assert.deepEqual(databases.songDb.prepare('SELECT * FROM requests').all(), before);
  assert.deepEqual(createSceneStore(databases.songDb).get('server/account', created.document.id), created);
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
  assert.equal(store.rotate({ ...mutation, expectedCapabilityVersion: 1, capability: capability(2) }), null);
  assert.deepEqual(store.get('owner-a', id), initial);
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
