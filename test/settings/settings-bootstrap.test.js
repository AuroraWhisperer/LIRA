'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { prepareSettingsBootstrap } = require('../../src/server/settings-bootstrap');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createScratchDirectory } = require('../helpers/scratch-directory');

function fixture(t, values) {
  const root = createScratchDirectory('settings-migration-');
  const filename = path.join(root, 'settings.db');
  let db = new DatabaseSync(filename);
  t.after(() => {
    try {
      db.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
  const insert = db.prepare('INSERT INTO settings VALUES (?, ?, ?)');
  for (const [key, value] of Object.entries(values)) insert.run(key, value, 'before');
  return {
    get db() {
      return db;
    },
    reopen() {
      db.close();
      db = new DatabaseSync(filename);
    },
    value(key) {
      return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
    },
  };
}

for (const version of ['1', undefined]) {
  test(`settings migration rolls back values and default versions on failure (${version ?? 'missing version'})`, (t) => {
    const values = {
      queueSongFontSize: '10',
      queueTitleFontSize: '8',
      scrollSeconds: '110',
    };
    if (version) values.queueFontSizeRangeVersion = version;
    const state = fixture(t, values);
    // Defaults may be inserted first. Fail only after the value was converted.
    state.db.exec(`CREATE TRIGGER fail_version BEFORE INSERT ON settings
      WHEN NEW.key = 'queueFontSizeRangeVersion'
      AND (SELECT value FROM settings WHERE key = 'queueSongFontSize') = '20'
      BEGIN SELECT RAISE(ABORT, 'version write failed'); END`);
    assert.throws(() => prepareSettingsBootstrap(state.db), /version write failed/);
    state.reopen();
    assert.equal(state.value('queueSongFontSize'), '10');
    assert.equal(state.value('queueTitleFontSize'), '8');
    assert.equal(state.value('queueFontSizeRangeVersion'), version);
    assert.equal(state.value('songScrollSpeedRangeVersion'), undefined);
    assert.equal(state.value('scrollSeconds'), '110');
    state.db.exec('DROP TRIGGER fail_version');
    prepareSettingsBootstrap(state.db);
    assert.equal(state.value('queueSongFontSize'), '20');
    assert.equal(state.value('queueTitleFontSize'), '16');
    assert.equal(state.value('queueFontSizeRangeVersion'), '2');
    assert.equal(state.value('scrollSeconds'), '51');
    state.reopen();
    prepareSettingsBootstrap(state.db);
    assert.equal(state.value('queueSongFontSize'), '20');
    assert.equal(state.value('scrollSeconds'), '51');
  });
}

test('new and already migrated settings remain stable on repeated startup', (t) => {
  const state = fixture(t, {});
  const first = prepareSettingsBootstrap(state.db).settingsStore.getSettings();
  assert.equal(first.scrollSeconds, '20');
  assert.equal(first.queueSongFontSize, DEFAULT_SETTINGS.queueSongFontSize);
  assert.equal(first.queueTitleFontSize, DEFAULT_SETTINGS.queueTitleFontSize);
  state.reopen();
  assert.deepEqual(prepareSettingsBootstrap(state.db).settingsStore.getSettings(), first);
  state.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('12', 'queueSongFontSize');
  state.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('45', 'scrollSeconds');
  state.reopen();
  prepareSettingsBootstrap(state.db);
  assert.equal(state.value('queueSongFontSize'), '12');
  assert.equal(state.value('scrollSeconds'), '45');
});

test('legacy rule cleanup runs once and preserves current user text across restarts', (t) => {
  for (const values of [{}, { queueStyleSettingsVersion: '1' }]) {
    const state = fixture(t, values);
    const store = prepareSettingsBootstrap(state.db).settingsStore;
    store.setSetting('overlayRule3', '同一观众 10 秒冷却');
    store.setSetting('overlayRule4', '按队列顺序演唱');
    state.reopen();
    prepareSettingsBootstrap(state.db);
    assert.equal(state.value('identityRuleDefaultsVersion'), '1');
    assert.equal(state.value('overlayRule3'), '同一观众 10 秒冷却');
    assert.equal(state.value('overlayRule4'), '按队列顺序演唱');
  }
  const upgraded = fixture(t, { queueStyleSettingsVersion: '1', overlayRule3: '同一观众 10 秒冷却' });
  prepareSettingsBootstrap(upgraded.db);
  assert.equal(upgraded.value('overlayRule3'), '同一观众 10 秒冷却');
  const legacy = fixture(t, { overlayRule3: '同一观众 10 秒冷却' });
  legacy.db.exec(`CREATE TRIGGER fail_rule_checkpoint BEFORE INSERT ON settings
    WHEN NEW.key = 'identityRuleDefaultsVersion' BEGIN SELECT RAISE(ABORT, 'checkpoint failed'); END;`);
  assert.throws(() => prepareSettingsBootstrap(legacy.db), /checkpoint failed/);
  assert.equal(legacy.value('overlayRule3'), '同一观众 10 秒冷却');
  assert.equal(legacy.value('identityRuleDefaultsVersion'), undefined);
  legacy.db.exec('DROP TRIGGER fail_rule_checkpoint');
  prepareSettingsBootstrap(legacy.db);
  assert.equal(legacy.value('overlayRule3'), '');
});

test('startup preserves saved song-board sizes, including the former default', (t) => {
  const state = fixture(t, { songBoardFontSize: '16' });
  prepareSettingsBootstrap(state.db);
  assert.equal(state.value('songBoardFontSize'), '16');
  for (const value of ['17', '16']) {
    state.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, 'songBoardFontSize');
    state.reopen();
    prepareSettingsBootstrap(state.db);
    assert.equal(state.value('songBoardFontSize'), value);
  }
});

test('an absent legacy queue font receives the current default without scaling', (t) => {
  const state = fixture(t, { queueTitleFontSize: '8' });
  prepareSettingsBootstrap(state.db);
  assert.equal(state.value('queueSongFontSize'), DEFAULT_SETTINGS.queueSongFontSize);
  assert.equal(state.value('queueTitleFontSize'), '16');
});

test('queue style 2 copies the legacy font once and then persists independently across startup', t => {
  const state = fixture(t, { overlayFontFamily: '"Lira Maiyuan"' });
  const store = prepareSettingsBootstrap(state.db).settingsStore;
  assert.equal(state.value('identityQueueFontFamily'), '"Lira Maiyuan"');
  store.setSetting('overlayFontFamily', '"STKaiti"');
  state.reopen();
  prepareSettingsBootstrap(state.db).settingsStore.setSetting('identityQueueFontFamily', '"Lira Smiley"');
  state.reopen();
  prepareSettingsBootstrap(state.db);
  assert.equal(state.value('overlayFontFamily'), '"STKaiti"');
  assert.equal(state.value('identityQueueFontFamily'), '"Lira Smiley"');
});

test('both queue fonts default to Microsoft YaHei on a new installation', t => {
  const state = fixture(t, {});
  prepareSettingsBootstrap(state.db);
  assert.equal(state.value('overlayFontFamily'), 'Microsoft YaHei');
  assert.equal(state.value('identityQueueFontFamily'), 'Microsoft YaHei');
});

test('independent queue font migration rolls back on failure and retries without data loss', t => {
  const state = fixture(t, { overlayFontFamily: '"STKaiti"' });
  state.db.exec(`CREATE TRIGGER reject_identity_font BEFORE INSERT ON settings
    WHEN NEW.key = 'identityQueueFontFamily' BEGIN SELECT RAISE(ABORT, 'font migration failed'); END;`);
  assert.throws(() => prepareSettingsBootstrap(state.db), /font migration failed/);
  assert.equal(state.value('identityQueueFontFamily'), undefined);
  assert.equal(state.value('queueFontSizeRangeVersion'), undefined);
  assert.equal(state.value('overlayFontFamily'), '"STKaiti"');
  state.db.exec('DROP TRIGGER reject_identity_font');
  prepareSettingsBootstrap(state.db);
  assert.equal(state.value('identityQueueFontFamily'), '"STKaiti"');
});
