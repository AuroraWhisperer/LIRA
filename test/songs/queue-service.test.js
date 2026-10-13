'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { addQueueItem } = require('../../src/music/queue-service');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createQueueStore } = require('../../src/storage/queue-store');
const { createSongStore } = require('../../src/storage/song-store');
const { createRequesterTargetStore } = require('../../src/storage/requester-target-store');
const { migrateQueueHistory } = require('../../src/storage/queue-history-store');
const { runMigrations } = require('../../src/storage/schema');

test('queue owner classifies expected request rejections without writing a request', () => {
  for (const [settings, count, duplicate, input, code] of [
    [{}, 0, false, {}, 'SONG_NAME_REQUIRED'],
    [{ queueLimit: '1' }, 1, false, { songName: '歌曲' }, 'QUEUE_FULL'],
    [{ onlyFromLibrary: 'true' }, 0, false, { songName: '歌曲' }, 'SONG_NOT_IN_LIBRARY'],
    [{ allowDuplicate: 'false' }, 0, true, { songName: '歌曲' }, 'SONG_ALREADY_QUEUED'],
  ]) {
    const context = { settings: () => settings, defaults: () => ({}),
      store: { countActive: () => count, findActiveBySongName: () => duplicate,
        insertRequest() { assert.fail('rejected requests must not be persisted'); } } };
    assert.throws(() => addQueueItem(context, input), { code });
  }
});

test('queue rejection codes reach HTTP and the existing optional danmaku reply', async () => {
  const { routes } = require('../../src/server/routes/queue-routes');
  const { handleDanmakuMessage } = require('../../src/bilibili/bilibili-message-handler');
  for (const code of ['QUEUE_FULL', 'SONG_NOT_IN_LIBRARY', 'SONG_ALREADY_QUEUED']) {
    const reject = () => { throw Object.assign(new Error('预期拒绝'), { code }); };
    const context = { queue: { add: reject, requestRandom: reject }, broadcastSnapshot() { assert.fail(); } };
    for (const route of ['POST /api/queue/add', 'POST /api/queue/random']) {
      const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
      await routes[route](context, { body: async () => ({ songName: '歌曲' }) }, response);
      assert.equal(response.status, 400);
      assert.equal(response.body.code, code);
    }
    for (const enabled of ['true', 'false']) {
      const result = handleDanmakuMessage({
        settings: () => ({ enableRandomTagReply: enabled }), settingsStore: { getDefaultSettings: () => ({}) },
        state: { cooldownByUser: new Map() }, addQueueItem: reject,
      }, { message: '点歌歌曲', uid: '1', userName: '观众' });
      assert.equal(result.accepted, false);
      assert.equal(result.code, code);
      assert.equal(Boolean(result.autoReply), enabled === 'true');
    }
  }
});

test('queue and request inserts roll back together when request persistence fails', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-queue-atomic-'));
  const db = createDatabases({ dataDir });
  const defaults = {
    queueLimit: '50',
    allowDuplicate: 'true',
    onlyFromLibrary: 'false',
  };

  try {
    db.songDb.exec(`
      CREATE TRIGGER fail_request_insert
      BEFORE INSERT ON requests
      BEGIN
        SELECT RAISE(ABORT, 'forced request failure');
      END
    `);

    assert.throws(
      () =>
        addQueueItem(
          {
            store: createQueueStore(db.songDb),
            settings: () => defaults,
            defaults: () => defaults,
          },
          {
            songName: 'Atomic Song',
            requesterName: 'Tester',
            message: 'request Atomic Song',
          },
        ),
      /forced request failure/,
    );

    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM queue').get().count, 0);
    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 0);
    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM song_cooldowns').get().count, 0);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function historyFixture(t) {
  const scratch = path.join(__dirname, '../../tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(scratch, 'queue-history-'));
  const db = createDatabases({ dataDir });
  t.after(() => {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const defaults = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false' };
  const store = createQueueStore(db.songDb);
  const context = { store, settings: () => defaults, defaults: () => defaults };
  return {
    db,
    dataDir,
    store,
    add: (input = {}) => addQueueItem(context, { songName: '保留的歌曲', ...input }),
    count: (table) => db.songDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  };
}

test('terminal queue actions remove raw rows immediately while active requests remain available', (t) => {
  const f = historyFixture(t);
  const first = f.add({ message: '第一条点歌弹幕' });
  const second = f.add({ songName: '正在排队', message: '第二条点歌弹幕' });
  f.store.setStatus(second.id, 'current', '2026-10-12T00:00:00Z');
  assert.equal(f.count('requests'), 2);
  f.store.setStatus(first.id, 'done', '2026-10-12T00:01:00Z');
  assert.equal(f.count('queue'), 1);
  assert.equal(f.count('requests'), 1);
  assert.equal(f.store.listActive()[0].request_message, '第二条点歌弹幕');
  assert.equal(f.store.clearActive('2026-10-12T00:02:00Z'), 1);
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('requests'), 0);
  assert.equal(f.store.clearActive('2026-10-12T00:03:00Z'), 0);
  assert.equal(f.store.completeNext('2026-10-12T00:03:00Z'), false);
});

test('a failed queue deletion rolls back removal of its request row', (t) => {
  const f = historyFixture(t);
  f.add();
  const before = f.store.listActive();
  f.db.songDb.exec(`CREATE TRIGGER fail_queue_delete BEFORE DELETE ON queue BEGIN
    SELECT RAISE(ABORT, 'forced queue deletion failure');
  END`);
  assert.throws(() => f.store.completeNext('2026-10-12T00:00:00Z'), /forced queue deletion failure/);
  assert.deepEqual(f.store.listActive(), before);
  assert.equal(f.count('requests'), 1);
  f.db.songDb.exec('DROP TRIGGER fail_queue_delete');
  assert.equal(f.store.completeNext('2026-10-12T00:00:00Z'), true);
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('requests'), 0);
});

test('random avoidance and mention target survive clearing with a bounded restart-safe history', (t) => {
  const f = historyFixture(t);
  for (let i = 0; i < 12; i++) {
    f.add({
      songName: `随机歌曲 ${i}`,
      source: i % 2 ? 'random:国语' : 'random',
      requesterUid: String(100 + i),
      requesterName: `观众 ${i}`,
      createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    });
    f.store.clearActive('2026-10-12T01:00:00Z');
  }
  f.add({ songName: '普通点歌', requesterUid: '999', requesterName: '普通点歌人' });
  f.store.clearActive('2026-10-12T02:00:00Z');
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('requests'), 0);
  assert.equal(f.count('random_request_history'), 10);
  const reopened = createDatabases({ dataDir: f.dataDir });
  try {
    assert.deepEqual(createSongStore(reopened.songDb).listRecentRandomSongNames(),
      Array.from({ length: 10 }, (_, i) => `随机歌曲 ${11 - i}`));
    assert.deepEqual(createRequesterTargetStore(reopened.songDb).getLatestRandomRequester(), {
      uid: '111', name: '观众 11', source: 'random:国语', createdAt: '2026-10-12T00:00:00.000Z',
    });
  } finally {
    closeDatabases(reopened);
  }
});

test('failed random history persistence rolls back the accepted queue and request', (t) => {
  const f = historyFixture(t);
  f.db.songDb.exec(`CREATE TRIGGER fail_random_history BEFORE INSERT ON random_request_history BEGIN
    SELECT RAISE(ABORT, 'forced random history failure');
  END`);
  assert.throws(() => f.add({ source: 'random' }), /forced random history failure/);
  for (const table of ['queue', 'requests', 'random_request_history', 'song_cooldowns']) {
    assert.equal(f.count(table), 0, table);
  }
});

test('queue history migration preserves active requests and only the required bounded random state', (t) => {
  const f = historyFixture(t);
  const active = f.add({ songName: '仍在排队', message: '保留上下文' });
  const current = f.add({ songName: '正在处理' });
  f.store.setStatus(current.id, 'current', '2026-10-12T00:00:00Z');
  const completed = f.add({ songName: '过去的普通点歌' });
  f.db.songDb.prepare("UPDATE queue SET status = 'done' WHERE id = ?").run(completed.id);
  const insert = f.db.songDb.prepare(`INSERT INTO requests
    (song_name, requester_uid, requester_name, source, created_at) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 0; i < 15; i++) {
    insert.run(`旧随机 ${i}`, i === 0 ? '123' : '', i === 0 ? '旧点歌人' : '',
      'random:流行', `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`);
  }
  insert.run('没有队列的旧普通点歌', '', '', 'admin', '2026-09-01T00:00:00Z');
  migrateQueueHistory(f.db.songDb);
  assert.deepEqual(f.store.listActive().map((row) => row.id), [active.id, current.id]);
  assert.equal(f.count('queue'), 2);
  assert.equal(f.count('requests'), 2);
  assert.equal(f.count('random_request_history'), 11);
  assert.deepEqual(createSongStore(f.db.songDb).listRecentRandomSongNames(),
    Array.from({ length: 10 }, (_, i) => `旧随机 ${14 - i}`));
  assert.equal(createRequesterTargetStore(f.db.songDb).getLatestRandomRequester().uid, '123');
  const before = f.db.songDb.prepare('SELECT * FROM random_request_history ORDER BY request_id').all();
  migrateQueueHistory(f.db.songDb);
  assert.deepEqual(f.db.songDb.prepare('SELECT * FROM random_request_history ORDER BY request_id').all(), before);
  assert.equal(f.count('requests'), 2);
});

test('queue history migration rolls back the compact state and removals if cleanup fails', (t) => {
  const f = historyFixture(t);
  const old = f.add();
  f.db.songDb.prepare("UPDATE queue SET status = 'deleted' WHERE id = ?").run(old.id);
  f.db.songDb.prepare("UPDATE requests SET source = 'random', requester_uid = '123' WHERE queue_id = ?")
    .run(old.id);
  f.db.songDb.exec(`DROP TABLE IF EXISTS random_request_history;
    CREATE TRIGGER fail_queue_delete BEFORE DELETE ON queue BEGIN
      SELECT RAISE(ABORT, 'forced queue deletion failure');
    END`);
  assert.throws(() => runMigrations(f.db.songDb, 'queue_cleanup_test', [migrateQueueHistory]),
    /forced queue deletion failure/);
  assert.equal(f.count('requests'), 1);
  assert.equal(f.count('queue'), 1);
  assert.equal(f.db.songDb.prepare("SELECT name FROM sqlite_master WHERE name = 'random_request_history'").get(), undefined);
  f.db.songDb.exec('DROP TRIGGER fail_queue_delete');
  runMigrations(f.db.songDb, 'queue_cleanup_test', [migrateQueueHistory]);
  assert.equal(f.count('requests'), 0);
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('random_request_history'), 1);
});
