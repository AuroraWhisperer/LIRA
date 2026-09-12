'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { prepareSettingsBootstrap } = require('../src/server/settings-bootstrap');

function fixture(t, values) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-settings-migration-'));
  const filename = path.join(root, 'settings.db');
  let db = new DatabaseSync(filename);
  t.after(() => {
    try { db.close(); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
  const insert = db.prepare('INSERT INTO settings VALUES (?, ?, ?)');
  for (const [key, value] of Object.entries(values)) insert.run(key, value, 'before');
  return {
    get db() { return db; },
    reopen() { db.close(); db = new DatabaseSync(filename); },
    value(key) { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value; },
  };
}

for (const version of ['1', undefined]) {
  test(`settings migration rolls back values and default versions on failure (${version ?? 'missing version'})`, (t) => {
    const values = { queueSongFontSize: '10', queueTitleFontSize: '8', scrollSeconds: '110' };
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
  state.reopen();
  assert.deepEqual(prepareSettingsBootstrap(state.db).settingsStore.getSettings(), first);
  state.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('12', 'queueSongFontSize');
  state.reopen();
  prepareSettingsBootstrap(state.db);
  assert.equal(state.value('queueSongFontSize'), '12');
});
