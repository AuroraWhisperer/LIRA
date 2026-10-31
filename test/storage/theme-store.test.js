'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { createDatabases, closeDatabases } = require('../../src/storage/database');
const { createSettingsStore } = require('../../src/storage/settings-store');
const { createThemeStore } = require('../../src/storage/theme-store');

test('applying a preset commits all allowed settings together and preserves them on failure', t => {
  const dataDir = createScratchDirectory('theme-settings-failure-');
  const databases = createDatabases({ dataDir });
  t.after(() => {
    closeDatabases(databases);
    removeScratchDirectory(dataDir);
  });
  const settings = createSettingsStore(databases.songDb);
  const themes = createThemeStore(databases.songDb, settings);
  settings.setSettings({ themePrimary: '#123456', themeAccent: '#abcdef' });
  const preset = themes.saveCurrent({ name: 'atomic preset', scope: 'overlay' });
  settings.setSettings({ themePrimary: '#654321', themeAccent: '#fedcba' });
  const previous = settings.getSettings();
  databases.songDb.exec(`CREATE TEMP TRIGGER reject_theme_accent BEFORE UPDATE ON settings
    WHEN NEW.key = 'themeAccent' BEGIN SELECT RAISE(ABORT, 'accent write failed'); END`);
  assert.throws(() => themes.apply(preset.id), /accent write failed/);
  assert.equal(settings.getSettings().themePrimary, previous.themePrimary);
  assert.equal(settings.getSettings().themeAccent, previous.themeAccent);
  assert.equal(createSettingsStore(databases.songDb).getSettings().themePrimary, previous.themePrimary);
  databases.songDb.exec('DROP TRIGGER reject_theme_accent');
  const result = themes.apply(preset.id);
  assert.equal(settings.getSettings().themePrimary, '#123456');
  assert.equal(settings.getSettings().themeAccent, '#abcdef');
  assert.ok(result.appliedKeys.includes('themePrimary'));
  assert.ok(result.appliedKeys.includes('themeAccent'));
  assert.equal(settings.getSettings().songBoardThemePrimary, previous.songBoardThemePrimary);
});
