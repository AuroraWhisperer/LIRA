'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const songService = require('../src/music/song-service');
const { createDomainServices } = require('../src/server/domain-services');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createSettingsStore } = require('../src/storage/settings-store');

function createTestDatabases(prefix) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dataDir,
    databases: createDatabases({ dataDir })
  };
}

function closeTestDatabases(testContext) {
  closeDatabases(testContext.databases);
  fs.rmSync(testContext.dataDir, { recursive: true, force: true });
}

test('unique song-name matching prefers exact names and ignores disabled or ambiguous matches', () => {
  const testContext = createTestDatabases('song-plugin-autocomplete-match-');
  const { songDb } = testContext.databases;

  try {
    songService.saveSong(songDb, { name: '不醉不会', artist: '田馥甄' });
    songService.saveSong(songDb, { name: '不醉不会现场版', artist: '田馥甄' });
    songService.saveSong(songDb, { name: '1022比尔的歌', artist: 'Bomb比尔' });
    songService.saveSong(songDb, { name: '比尔隐藏版', isEnabled: false });
    songService.saveSong(songDb, { name: '100%真心', artist: '测试歌手' });
    songService.saveSong(songDb, { name: '1000真心', artist: '测试歌手' });

    assert.equal(songService.findUniqueSongNameMatch(songDb, '不醉不会').name, '不醉不会');
    assert.equal(songService.findUniqueSongNameMatch(songDb, '不醉'), null);
    assert.equal(songService.findUniqueSongNameMatch(songDb, '比尔').name, '1022比尔的歌');
    assert.equal(songService.findUniqueSongNameMatch(songDb, '100%').name, '100%真心');
  } finally {
    closeTestDatabases(testContext);
  }
});

test('danmaku requests enqueue the complete unique library name and preserve the original message', () => {
  const testContext = createTestDatabases('song-plugin-autocomplete-danmaku-');
  const settingsStore = createSettingsStore(testContext.databases.songDb);

  try {
    settingsStore.setSetting('onlyFromLibrary', 'true');
    const services = createDomainServices({
      db: testContext.databases,
      settingsStore
    });
    services.songs.save({
      name: '1022比尔的歌',
      artist: 'Bomb比尔',
      categoryName: '流行'
    });

    const result = services.messages.handleDanmaku({
      message: '点歌 比尔',
      userName: '观众',
      uid: '123'
    });

    assert.equal(result.accepted, true);
    assert.equal(result.queueItem.song_name, '1022比尔的歌');
    assert.equal(result.queueItem.artist, 'Bomb比尔');
    assert.equal(result.queueItem.category_name, '流行');
    assert.equal(
      testContext.databases.songDb.prepare('SELECT message FROM requests WHERE queue_id = ?')
        .get(result.queueItem.id).message,
      '点歌 比尔'
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
      settingsStore
    });
    services.songs.save({ name: '不醉不会', artist: '田馥甄' });
    services.songs.save({ name: '不醉不归', artist: '测试歌手' });

    const result = services.messages.handleDanmaku({
      message: '点歌 不醉',
      userName: '观众',
      uid: '456'
    });

    assert.equal(result.accepted, true);
    assert.equal(result.queueItem.song_name, '不醉');
    assert.equal(result.queueItem.song_id, null);
  } finally {
    closeTestDatabases(testContext);
  }
});
