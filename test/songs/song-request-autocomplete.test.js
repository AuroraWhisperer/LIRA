'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const songService = require('../../src/music/song-service');
const { createDomainServices } = require('../../src/server/domain-services');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createSongStore } = require('../../src/storage/song-store');
const { createSettingsStore } = require('../../src/storage/settings-store');
const { songRequestReason } = require('../../src/bilibili/diagnostics');

function createTestSongStore(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SONG_SCHEMA);
  return createSongStore(db);
}

function createTestDatabases(prefix) {
  const tempRoot = path.resolve(__dirname, '../../tmp/song-request-autocomplete');
  fs.mkdirSync(tempRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(tempRoot, prefix));
  return {
    dataDir,
    databases: createDatabases({ dataDir }),
  };
}

function closeTestDatabases(testContext) {
  closeDatabases(testContext.databases);
  fs.rmSync(testContext.dataDir, { recursive: true, force: true });
}

test('song matching folds both scripts, preserves exact priority and counts variant ambiguities', (t) => {
  const store = createTestSongStore(t);
  const simplified = songService.saveSong(store, { name: '后来', artist: '刘若英' });
  const traditional = songService.saveSong(store, { name: '聽海', artist: '張惠妹' });
  assert.equal(songService.findSong(store, '後來', '劉若英').id, simplified.id);
  assert.equal(songService.findSong(store, '听海', '张惠妹').id, traditional.id);
  songService.saveSong(store, { name: '後來', artist: '另一位歌手' });
  assert.equal(songService.findUniqueSongNameMatch(store, '后来').id, simplified.id);
  songService.saveSong(store, { name: '聽說你' });
  assert.equal(songService.findUniqueSongNameMatch(store, '听说', 'prefix').name, '聽說你');
  songService.saveSong(store, { name: '听说爱情回来过' });
  assert.equal(songService.findUniqueSongNameMatch(store, '聽說', 'prefix'), null);
  songService.saveSong(store, { name: '如果你也听说' });
  assert.equal(songService.findUniqueSongNameMatch(store, '也聽說').name, '如果你也听说');
  songService.saveSong(store, { name: '也聽說過' });
  assert.equal(songService.findUniqueSongNameMatch(store, '也听说'), null);
});

test('traditional danmaku resolves library titles while retaining raw requests and blacklist rules', () => {
  const f = createTestDatabases('traditional-danmaku-');
  try {
    const settingsStore = createSettingsStore(f.databases.songDb);
    settingsStore.setSettings({ onlyFromLibrary: 'true', songRequestRequireSpace: 'true', songRequestBlacklist: '廣島之戀' });
    const services = createDomainServices({ db: f.databases, settingsStore });
    services.songs.save({ name: '后来', artist: '刘若英' });
    const message = '點歌 後來';
    const accepted = services.messages.handleDanmaku({ message, userName: '觀眾', uid: '123' });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.queueItem.song_name, '后来');
    assert.equal(accepted.queueItem.requester_name, '觀眾');
    assert.equal(f.databases.songDb.prepare('SELECT message FROM requests WHERE queue_id = ?')
      .get(accepted.queueItem.id).message, message);
    assert.equal(services.messages.handleDanmaku({ message: '點歌後來', uid: '123' }).accepted, false);
    const blocked = services.messages.handleDanmaku({ message: '點歌 广岛之恋', uid: '123' });
    assert.equal(songRequestReason(blocked.reason), 'song-request-blacklisted');
  } finally {
    closeTestDatabases(f);
  }
});

test('unique song-name matching prefers exact names and ignores disabled or ambiguous matches', (t) => {
  const songStore = createTestSongStore(t);

  songService.saveSong(songStore, { name: '不醉不会', artist: '田馥甄' });
  songService.saveSong(songStore, {
    name: '不醉不会现场版',
    artist: '田馥甄',
  });
  songService.saveSong(songStore, {
    name: '1022比尔的歌',
    artist: 'Bomb比尔',
  });
  songService.saveSong(songStore, { name: '比尔隐藏版', isEnabled: false });
  songService.saveSong(songStore, { name: '100%真心', artist: '测试歌手' });
  songService.saveSong(songStore, { name: '1000真心', artist: '测试歌手' });

  assert.equal(songService.findUniqueSongNameMatch(songStore, '不醉不会').name, '不醉不会');
  assert.equal(songService.findUniqueSongNameMatch(songStore, '不醉'), null);
  assert.equal(songService.findUniqueSongNameMatch(songStore, '比尔').name, '1022比尔的歌');
  assert.equal(songService.findUniqueSongNameMatch(songStore, '100%').name, '100%真心');
});

test('danmaku requests enqueue the complete unique library name and preserve the original message', () => {
  const testContext = createTestDatabases('song-plugin-autocomplete-danmaku-');
  const settingsStore = createSettingsStore(testContext.databases.songDb);

  try {
    settingsStore.setSetting('onlyFromLibrary', 'true');
    const services = createDomainServices({
      db: testContext.databases,
      settingsStore,
    });
    services.songs.save({
      name: '1022比尔的歌',
      artist: 'Bomb比尔',
      categoryName: '流行',
    });

    const result = services.messages.handleDanmaku({
      message: '点歌 比尔',
      userName: '观众',
      uid: '123',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.queueItem.song_name, '1022比尔的歌');
    assert.equal(result.queueItem.artist, 'Bomb比尔');
    assert.equal(result.queueItem.category_name, '流行');
    assert.equal(
      testContext.databases.songDb.prepare('SELECT message FROM requests WHERE queue_id = ?').get(result.queueItem.id)
        .message,
      '点歌 比尔',
    );
  } finally {
    closeTestDatabases(testContext);
  }
});

test('danmaku requests preserve the submitted name when multiple library songs match', () => {
  const testContext = createTestDatabases('song-plugin-autocomplete-ambiguous-');
  const settingsStore = createSettingsStore(testContext.databases.songDb);

  try {
    const services = createDomainServices({
      db: testContext.databases,
      settingsStore,
    });
    services.songs.save({ name: '不醉不会', artist: '田馥甄' });
    services.songs.save({ name: '不醉不归', artist: '测试歌手' });

    const result = services.messages.handleDanmaku({
      message: '点歌 不醉',
      userName: '观众',
      uid: '456',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.queueItem.song_name, '不醉');
    assert.equal(result.queueItem.song_id, null);
  } finally {
    closeTestDatabases(testContext);
  }
});

test('prefix matching prefers an enabled title prefix without guessing between multiple prefixes', (t) => {
  const songStore = createTestSongStore(t);

  songService.saveSong(songStore, { name: '如果你也听说' });
  songService.saveSong(songStore, { name: '我曾听说' });
  songService.saveSong(songStore, { name: '听说你', artist: '于冬然' });
  songService.saveSong(songStore, { name: '听说再见', isEnabled: false });
  songService.saveSong(songStore, { name: '100%真心' });
  songService.saveSong(songStore, { name: '1000真心' });
  assert.equal(songService.findUniqueSongNameMatch(songStore, '听说', 'prefix').name, '听说你');
  assert.equal(songService.findUniqueSongNameMatch(songStore, '你也', 'prefix').name, '如果你也听说');
  assert.equal(songService.findUniqueSongNameMatch(songStore, '100%', 'prefix').name, '100%真心');
  songService.saveSong(songStore, { name: '听说爱情回来过' });
  assert.equal(songService.findUniqueSongNameMatch(songStore, '听说', 'prefix'), null);
  songService.saveSong(songStore, { name: '听说' });
  assert.equal(songService.findUniqueSongNameMatch(songStore, '听说', 'prefix').name, '听说');
});

test('changing the matching mode applies to the next request and preserves earlier queue entries', () => {
  const testContext = createTestDatabases('prefix-mode-');
  const settingsStore = createSettingsStore(testContext.databases.songDb);
  try {
    const services = createDomainServices({ db: testContext.databases, settingsStore });
    services.songs.save({ name: '如果你也听说', artist: '张惠妹' });
    const song = services.songs.save({ name: '听说你', artist: '于冬然' });
    const request = { message: '点歌 听说', userName: '观众', uid: '123' };
    const original = services.messages.handleDanmaku(request);
    assert.equal(original.queueItem.song_name, '听说');
    settingsStore.setSettings({ songRequestMatchMode: 'prefix', onlyFromLibrary: 'true' });
    const completed = services.messages.handleDanmaku(request);
    assert.equal(completed.accepted, true);
    assert.equal(completed.queueItem.song_id, song.id);
    assert.equal(completed.queueItem.song_name, '听说你');
    assert.equal(completed.queueItem.artist, '于冬然');
    assert.equal(testContext.databases.songDb.prepare('SELECT message FROM requests WHERE queue_id = ?')
      .get(completed.queueItem.id).message, request.message);
    settingsStore.setSetting('songRequestMatchMode', 'unique');
    assert.equal(services.messages.handleDanmaku(request).code, 'SONG_NOT_IN_LIBRARY');
    assert.equal(testContext.databases.songDb.prepare('SELECT song_name FROM queue WHERE id = ?')
      .get(original.queueItem.id).song_name, '听说');
  } finally {
    closeTestDatabases(testContext);
  }
});

test('blacklisted request text is rejected before autocomplete without consuming cooldown or writing requests', () => {
  const testContext = createTestDatabases('song-plugin-blacklist-');
  const settingsStore = createSettingsStore(testContext.databases.songDb);
  try {
    settingsStore.setSettings({ songRequestBlacklist: '78\n不要唱', userCooldownSeconds: '60' });
    const services = createDomainServices({ db: testContext.databases, settingsStore });
    services.songs.save({ name: '78号公路' });
    for (const message of ['点歌78', '点歌 78', '点歌　78　', '点歌 不要唱']) {
      const result = services.messages.handleDanmaku({ message, userName: '观众', uid: '123' });
      assert.equal(result.accepted, false, message);
      assert.equal(songRequestReason(result.reason), 'song-request-blacklisted');
    }
    assert.equal(testContext.databases.songDb.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 0);
    const allowed = services.messages.handleDanmaku({ message: '点歌78号公路', userName: '观众', uid: '123' });
    assert.equal(allowed.accepted, true);
    assert.equal(allowed.queueItem.song_name, '78号公路');
    assert.equal(testContext.databases.songDb.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 1);
  } finally {
    closeTestDatabases(testContext);
  }
});

test('blacklist changes take effect on the next request and do not filter random commands', () => {
  const testContext = createTestDatabases('song-plugin-blacklist-clear-');
  const settingsStore = createSettingsStore(testContext.databases.songDb);
  try {
    settingsStore.setSetting('songRequestBlacklist', '78');
    const services = createDomainServices({ db: testContext.databases, settingsStore });
    services.songs.save({ name: '晴天' });
    const request = { message: '点歌78', userName: '观众', uid: '123' };
    assert.equal(services.messages.handleDanmaku(request).accepted, false);
    assert.equal(services.messages.handleDanmaku({ ...request, message: '随机点歌' }).accepted, true);
    settingsStore.setSetting('songRequestBlacklist', '');
    assert.equal(services.messages.handleDanmaku(request).accepted, true);
  } finally {
    closeTestDatabases(testContext);
  }
});
