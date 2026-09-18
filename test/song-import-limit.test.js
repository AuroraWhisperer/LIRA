'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSongStore } = require('../src/storage/song-store');
const songService = require('../src/music/song-service');
const { buildSongsWorkbook } = require('../src/music/song-file-codec');
const { routes } = require('../src/server/routes/song-routes');

const limitError = { code: 'SONG_IMPORT_LIMIT_EXCEEDED', statusCode: 422 };

function songs(count, prefix = '歌曲') {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}${index}`,
    artist: '歌手',
    isEnabled: false,
    categoryName: '新分类',
  }));
}

function fixture(t, count = 0) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  db.exec('CREATE UNIQUE INDEX idx_songs_name_artist ON songs(name, artist)');
  t.after(() => db.close());
  const store = createSongStore(db);
  const category = store.ensureCategory('原分类');
  const insert = db.prepare(`
    INSERT INTO songs (name, artist, category_id, is_enabled, created_at, updated_at)
    VALUES (?, '歌手', ?, 0, 'fixture', 'fixture')
  `);
  db.exec('BEGIN');
  for (let index = 0; index < count; index += 1) {
    insert.run(`歌曲${index}`, category.id);
  }
  db.exec('COMMIT');
  return {
    db,
    store,
    snapshot: () =>
      ['songs', 'song_categories', 'import_batches', 'queue', 'requests'].map(
        (table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ),
  };
}

test('legacy store rejects 5001 songs before inserting songs, categories or a batch', (t) => {
  const { db, store, snapshot } = fixture(t);
  const before = snapshot();
  db.exec(`CREATE TRIGGER reject_write BEFORE INSERT ON songs
    BEGIN SELECT RAISE(ABORT, 'unexpected song write'); END`);
  assert.throws(() => store.importRows(songs(5001)), limitError);
  assert.deepEqual(snapshot(), before);
});

test('legacy merge counts disabled existing songs and deduplicates identities before checking 5000', (t) => {
  const { store, snapshot } = fixture(t, 4999);
  const before = snapshot();
  assert.throws(
    () => songService.importSongs(store, songs(2, '新增')),
    limitError,
  );
  assert.deepEqual(snapshot(), before);

  const result = songService.importSongs(store, [
    ...songs(1),
    ...songs(1, '新增'),
    ...songs(1, '新增'),
  ]);
  assert.equal(result.inserted, 1);
  assert.equal(result.duplicate, 2);
  assert.equal(store.countSongs(), 5000);
  assert.equal(
    store.listRows().find((row) => row.name === '歌曲0').is_enabled,
    0,
  );
  assert.equal(store.listCategories().length, 2);

  const full = snapshot();
  assert.throws(
    () => songService.importSongs(store, songs(1, '第5001首')),
    limitError,
  );
  assert.deepEqual(snapshot(), full);
});

test('legacy duplicate-only import preserves existing over-limit libraries and requests cleanup', (t) => {
  const { store, snapshot } = fixture(t, 5001);
  const before = snapshot();
  assert.throws(
    () => songService.importSongs(store, songs(1)),
    (error) => {
      assert.equal(error.code, limitError.code);
      assert.match(error.message, /先在歌库整理至 5000 首以内/);
      return true;
    },
  );
  assert.deepEqual(snapshot(), before);
});

test('legacy import checks the deduplicated result without imposing a new raw input limit', (t) => {
  const { store } = fixture(t);
  const result = songService.importSongs(store, Array(5001).fill(songs(1)[0]));
  assert.equal(result.inserted, 1);
  assert.equal(result.duplicate, 5000);
  assert.equal(store.countSongs(), 1);
});

test('replacement rejects oversized results before detaching references or removing old rows', (t) => {
  const { db, store, snapshot } = fixture(t, 1);
  db.exec(`
    INSERT INTO queue (song_id, song_name, created_at, updated_at)
      VALUES (1, '歌曲0', 'fixture', 'fixture');
    INSERT INTO requests (queue_id, song_id, song_name, created_at)
      VALUES (1, 1, '歌曲0', 'fixture');
  `);
  const before = snapshot();
  assert.throws(() => store.replaceAll(songs(5001, '替换')), limitError);
  assert.deepEqual(snapshot(), before);

  const result = songService.replaceCloudSongs(store, [
    ...songs(4999, '替换'),
    ...songs(1, '替换'),
  ]);
  assert.deepEqual(result, { total: 5000, count: 4999, duplicate: 1 });
  assert.equal(store.countSongs(), 4999);
  assert.equal(db.prepare('SELECT song_id FROM queue').get().song_id, null);
  assert.equal(db.prepare('SELECT song_id FROM requests').get().song_id, null);
});

test('explicit replacement may bring a historical oversized library within the limit', (t) => {
  const { store } = fixture(t, 5001);
  assert.deepEqual(store.replaceAll(songs(5000, '替换')), { count: 5000 });
  assert.equal(store.countSongs(), 5000);
});

for (const format of ['import', 'import-xlsx']) {
  test(`legacy ${format} route returns 422 without broadcasting or syncing a rejected import`, async (t) => {
    const { store, snapshot } = fixture(t, 4999);
    const signals = [];
    const context = {
      songs: { import: (rows) => songService.importSongs(store, rows) },
      broadcastSnapshot: (reason) => signals.push(reason),
      cloudSync: { request: (scope) => signals.push(scope) },
    };
    async function call(rows) {
      const response = {
        writeHead(status) {
          this.status = status;
        },
        end(body) {
          this.body = JSON.parse(body);
        },
      };
      const body =
        format === 'import'
          ? { rows }
          : { base64: buildSongsWorkbook(rows).toString('base64') };
      await routes[`POST /api/songs/${format}`](
        context,
        { body: async () => body },
        response,
      );
      return response;
    }
    const before = snapshot();
    const rejected = await call(songs(2, '新增'));
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.error, limitError.code);
    assert.match(rejected.body.message, /5000/);
    assert.deepEqual(signals, []);
    assert.deepEqual(snapshot(), before);

    const accepted = await call(songs(1, '新增'));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.inserted, 1);
    assert.deepEqual(signals, [`songs:${format}`, 'songs']);
    assert.equal(store.countSongs(), 5000);
  });
}
