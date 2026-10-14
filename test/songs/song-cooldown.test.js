'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { createDatabases, closeDatabases, runAllMigrations, clearAllData } = require('../../src/storage/database');
const { createQueueStore } = require('../../src/storage/queue-store');
const { createSongStore } = require('../../src/storage/song-store');
const queue = require('../../src/music/queue-service');
const songs = require('../../src/music/song-service');
const { handleDanmakuMessage } = require('../../src/bilibili/bilibili-message-handler');
const { routes } = require('../../src/server/routes/queue-routes');

function fixture(t, patch = {}) {
  const directory = createScratchDirectory('song-cooldown-');
  let db = createDatabases({ dataDir: directory });
  let scope = 'streamer-a';
  const settings = { queueLimit: '50', allowDuplicate: 'true', userCooldownSeconds: '0',
    songCooldownMode: 'hours', songCooldownValue: '6', enableRandomTagReply: 'true', ...patch };
  const context = { settings: () => settings, defaults: () => settings };
  let songStore;
  function connect() {
    context.store = createQueueStore(db.songDb, { getFanScope: () => scope });
    songStore = createSongStore(db.songDb);
    context.findSong = (name, artist) => songs.findSong(songStore, name, artist);
  }
  connect();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-12T15:55:00Z') });
  t.after(() => {
    closeDatabases(db);
    removeScratchDirectory(directory);
  });
  const add = (input = {}) => queue.addQueueItem(context, { songName: '晴天', requesterName: '甲', ...input });
  const messageContext = {
    settings: context.settings, settingsStore: { getDefaultSettings: context.defaults },
    state: { cooldownByUser: new Map() }, addQueueItem: add,
    resolveSongRequest: (name) => songs.findUniqueSongNameMatch(songStore, name),
    pickRandomSong: (scopeText) => songs.pickRandomSong(songStore, scopeText,
      (candidates) => queue.filterSongsByCooldown(context, candidates)),
  };
  return {
    settings, context, add,
    get db() { return db; },
    scope(value) { scope = value; },
    reopen() { closeDatabases(db); db = createDatabases({ dataDir: directory }); connect(); },
    saveSong: (song) => songs.saveSong(songStore, song),
    message: (message, uid = '2') => handleDanmakuMessage(messageContext, { message, uid, userName: '乙' }),
    get userCooldowns() { return messageContext.state.cooldownByUser; },
  };
}

test('cooldown starts at acceptance, is shared by viewers, and rejects without extending it', (t) => {
  const f = fixture(t);
  f.add({ messageTimestamp: '2020-01-01T00:00:00Z' });
  t.mock.timers.tick(60 * 60 * 1000);
  const rejected = f.message('点歌晴天');
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.autoReply.message, '《晴天》冷却中，还需 5小时。');
  assert.deepEqual(rejected.autoReply.target, { uid: '2', name: '乙' });
  assert.equal(f.context.store.countActive(), 1);
  assert.equal(f.userCooldowns.size, 0);
  f.settings.enableRandomTagReply = 'false';
  assert.equal(f.message('点歌晴天').autoReply, null);
  t.mock.timers.tick(5 * 60 * 60 * 1000 - 1);
  assert.throws(() => f.add(), /还需 1分/);
  t.mock.timers.tick(1);
  assert.equal(f.message('点歌晴天').accepted, true);
});

for (const days of [1, 2]) {
  test(`${days} natural days expire at the correct Beijing midnight`, (t) => {
    const f = fixture(t, { songCooldownMode: 'days', songCooldownValue: String(days) });
    f.add();
    assert.throws(() => f.add(), days === 1 ? /明天 00:00/ : /后天 00:00/);
    t.mock.timers.tick(5 * 60 * 1000 + (days - 1) * 86400000 - 1);
    assert.throws(() => f.add(), { code: 'SONG_COOLDOWN' });
    t.mock.timers.tick(1);
    assert.ok(f.add().id);
  });
}

test('queue changes, restart and a library replacement preserve cooldown; account scopes are isolated', (t) => {
  const f = fixture(t);
  for (const action of ['done', 'skip', 'delete', 'clear']) {
    const item = f.add({ songName: action });
    queue.handleQueueAction(f.context, action, item.id);
    assert.throws(() => f.add({ songName: action }), { code: 'SONG_COOLDOWN' });
  }
  const original = f.saveSong({ name: '晴天', artist: '周杰伦' });
  f.add();
  f.db.songDb.prepare('UPDATE queue SET song_id = NULL').run();
  f.db.songDb.prepare('UPDATE requests SET song_id = NULL').run();
  f.db.songDb.prepare('DELETE FROM songs').run();
  const replacement = f.saveSong({ name: '晴天', artist: '周杰伦' });
  assert.notEqual(replacement.id, original.id);
  f.reopen();
  assert.throws(() => f.add(), { code: 'SONG_COOLDOWN' });
  f.scope('streamer-b');
  assert.ok(f.add().id);
  f.scope('streamer-a');
  assert.throws(() => f.add(), { code: 'SONG_COOLDOWN' });
});

test('changing a rule recalculates the last acceptance and queue duplicates remain independently blocked', (t) => {
  const f = fixture(t, { songCooldownMode: 'off' });
  f.add();
  f.settings.songCooldownMode = 'hours';
  f.settings.allowDuplicate = 'false';
  assert.throws(() => f.add(), { code: 'SONG_COOLDOWN' });
  t.mock.timers.tick(2 * 3600000);
  f.settings.songCooldownValue = '1';
  assert.throws(() => f.add(), /队列里已经有/);
  queue.handleQueueAction(f.context, 'clear');
  assert.ok(f.add().id);
  f.settings.songCooldownMode = 'off';
  f.settings.allowDuplicate = 'true';
  assert.ok(f.add().id);
});

test('matched abbreviations share cooldown, artists stay distinct, and random selection excludes cooling songs', (t) => {
  const f = fixture(t);
  f.saveSong({ name: '晴天', artist: '周杰伦', language: '国语' });
  f.saveSong({ name: '七里香', artist: '周杰伦', language: '国语' });
  assert.equal(f.message('点歌晴天').accepted, true);
  assert.equal(f.message('点歌晴').accepted, false);
  const random = f.message('随机点歌 国语');
  assert.equal(random.accepted, true);
  assert.equal(random.queueItem.song_name, '七里香');
  const exhausted = f.message('随机点歌 国语');
  assert.equal(exhausted.accepted, false);
  assert.equal(exhausted.autoReply.message, '符合条件的歌曲都在冷却，请稍后再试。');
  assert.match(f.message('随机点歌 英语').autoReply.message, /没有「英语」/);
  f.saveSong({ name: '晴天', artist: '另一位歌手' });
  assert.ok(f.add({ artist: '另一位歌手' }).id);
});

test('cooldown write failure rolls back admission and a retry can succeed', (t) => {
  const f = fixture(t);
  f.db.songDb.exec(`CREATE TRIGGER fail_cooldown BEFORE INSERT ON song_cooldowns
    BEGIN SELECT RAISE(ABORT, 'synthetic cooldown failure'); END`);
  assert.throws(() => f.add(), /synthetic cooldown failure/);
  assert.equal(f.context.store.countActive(), 0);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
  f.db.songDb.exec('DROP TRIGGER fail_cooldown');
  assert.ok(f.add().id);
});

test('manual admission returns a readable cooldown error without broadcasting another queue item', async (t) => {
  const f = fixture(t);
  let broadcasts = 0;
  const context = { queue: { add: f.add }, broadcastSnapshot: () => broadcasts++ };
  async function request() {
    const response = {
      writeHead(status) { this.status = status; },
      end(body) { this.body = JSON.parse(body); },
    };
    await routes['POST /api/queue/add'](context, { body: async () => ({ songName: '晴天' }) }, response);
    return response;
  }
  assert.equal((await request()).status, 200);
  const rejected = await request();
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /《晴天》冷却中/);
  assert.equal(broadcasts, 1);
  assert.equal(f.context.store.countActive(), 1);
});

test('migration upgrades an existing library once and full data clearing removes cooldown records', (t) => {
  const schema = require('../../src/storage/schema');
  const migrate = schema.runMigrations;
  const legacy = t.mock.method(schema, 'runMigrations', (db, key, steps) =>
    migrate(db, key, key === 'song_db' ? steps.slice(0, 11) : steps));
  let f;
  try { f = fixture(t); } finally { legacy.mock.restore(); }
  f.saveSong({ name: '已有歌曲' });
  runAllMigrations(f.db);
  f.add();
  runAllMigrations(f.db);
  assert.equal(f.context.store.listSongCooldowns().length, 1);
  assert.equal(f.db.songDb.prepare('SELECT name FROM songs').get().name, '已有歌曲');
  const { songDb, superChatDb, giftDb, musicDb, checkinDb } = f.db;
  clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb);
  assert.equal(f.context.store.listSongCooldowns().length, 0);
});
