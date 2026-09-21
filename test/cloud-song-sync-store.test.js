'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSongStore } = require('../src/storage/song-store');
const { createSettingsStore } = require('../src/storage/settings-store');
const { createCloudSongSyncStore } = require('../src/storage/cloud-song-sync-store');
const { clearSongLibraryData } = require('../src/storage/database-maintenance');
const { clearSongDataInTransaction } = require('../src/storage/database-clear-operations');
const songService = require('../src/music/song-service');
const { previewSongImport, applySongImport } = require('../src/music/song-import-update');

const ACCOUNT_A = JSON.stringify(['https://api.example.test', 'first', 1]);
const ACCOUNT_B = JSON.stringify(['https://api.example.test', 'second', 2]);

function fixture(t, filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const settings = createSettingsStore(db);
  const songs = createSongStore(db);
  const pending = createCloudSongSyncStore(db);
  songService.saveSong(songs, { name: 'Original', artist: 'Artist', categoryName: 'Category' });
  settings.prepareCloudRoomAccount(ACCOUNT_A);
  return { db, settings, songs, pending };
}

const mutations = {
  save: (f) => songService.saveSong(f.songs, { name: 'Added', categoryName: 'New category' }),
  update: (f) => songService.saveSong(f.songs, {
    id: f.songs.listRows()[0].id, name: 'Updated', isEnabled: false,
    requestPrice: '舰长', songClip: 'BV1', sourcePlatform: 'QQ音乐',
  }),
  toggle: (f) => f.songs.toggleSong(f.songs.listRows()[0].id),
  delete: (f) => f.songs.deleteSong(f.songs.listRows()[0].id),
  import: (f) => songService.importSongs(f.songs, [{ name: 'Imported', categoryName: 'Imported category' }]),
  'import-update': (f) => {
    const input = { rows: [{ name: 'Original', artist: 'Artist', requestPrice: '30元SC' }] };
    const preview = previewSongImport(f.songs, input);
    return applySongImport(f.songs, { ...input, previewToken: preview.previewToken });
  },
  clear: (f) => clearSongLibraryData(f.db),
  'clear-all': (f) => {
    f.db.exec('BEGIN');
    try {
      clearSongDataInTransaction(f.db, {});
      f.db.exec('COMMIT');
    } catch (error) {
      f.db.exec('ROLLBACK');
      throw error;
    }
  },
};

for (const [name, mutate] of Object.entries(mutations)) {
  test(`${name} persists a complete pending snapshot with the song transaction`, (t) => {
    const f = fixture(t);
    assert.equal(f.pending.readPending(ACCOUNT_A), null);
    mutate(f);
    const pending = f.pending.readPending(ACCOUNT_A);
    assert.ok(pending?.mutationId);
    assert.deepEqual(pending.songs, JSON.parse(JSON.stringify(f.songs.listRows())));
  });

  test(`${name} rolls back when the pending snapshot cannot be saved`, (t) => {
    const f = fixture(t);
    mutations.save(f);
    const tables = ['songs', 'song_categories', 'import_batches', 'queue', 'requests', 'settings'];
    const snapshot = () => tables.map((table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot();
    f.db.exec(`CREATE TRIGGER reject_pending BEFORE INSERT ON settings
      WHEN NEW.key LIKE 'cloudSongSyncPending:%'
      BEGIN SELECT RAISE(ABORT, 'PENDING_WRITE_FAILED'); END`);
    assert.throws(() => mutate(f), /PENDING_WRITE_FAILED/);
    assert.deepEqual(snapshot(), before);
  });
}

test('pending metadata is private and cloud replacements do not create upload echoes', (t) => {
  const f = fixture(t);
  f.songs.ensureCategory('Empty category');
  songService.replaceCloudSongs(f.songs, [{ name: 'Cloud', artist: 'Artist' }]);
  assert.equal(f.pending.readPending(ACCOUNT_A), null);
  mutations.save(f);
  const settings = createSettingsStore(f.db).getSettings();
  assert.equal(settings.cloudRoomAccountKey, undefined);
  assert.equal(Object.keys(settings).some((key) => key.startsWith('cloudSongSyncPending:')), false);
  const saved = f.pending.readPending(ACCOUNT_A);
  songService.replaceCloudSongs(f.songs, []);
  assert.deepEqual(f.pending.readPending(ACCOUNT_A), saved);
});

test('acknowledgement matches the account and mutation, preserving newer edits and other accounts', (t) => {
  const f = fixture(t);
  mutations.save(f);
  const first = f.pending.readPending(ACCOUNT_A);
  mutations.toggle(f);
  const second = f.pending.readPending(ACCOUNT_A);
  assert.notEqual(second.mutationId, first.mutationId);
  assert.equal(f.pending.acknowledge(ACCOUNT_A, first.mutationId), false);
  assert.equal(f.pending.acknowledge(ACCOUNT_B, second.mutationId), false);
  f.settings.prepareCloudRoomAccount(ACCOUNT_B);
  mutations.clear(f);
  assert.deepEqual(f.pending.readPending(ACCOUNT_A), second);
  assert.deepEqual(f.pending.readPending(ACCOUNT_B).songs, []);
  assert.equal(f.pending.acknowledge(ACCOUNT_A, second.mutationId), true);
  assert.equal(f.pending.readPending(ACCOUNT_A), null);
  assert.deepEqual(f.pending.readPending(ACCOUNT_B).songs, []);
});

test('pending edits survive closing and reopening SQLite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-song-pending-'));
  const filename = path.join(directory, 'songs.db');
  let db = new DatabaseSync(filename);
  try {
    db.exec(SONG_SCHEMA);
    createSettingsStore(db).prepareCloudRoomAccount(ACCOUNT_A);
    songService.saveSong(createSongStore(db), { name: 'Offline edit' });
    const pending = createCloudSongSyncStore(db).readPending(ACCOUNT_A);
    db.close();
    db = new DatabaseSync(filename);
    assert.ok(pending?.mutationId);
    assert.deepEqual(createCloudSongSyncStore(db).readPending(ACCOUNT_A), pending);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
