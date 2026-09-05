// 编写人：Aurora
// 设置读写。
// 通过 createSettingsStore(db) 初始化，不自动假设全局数据库连接。
'use strict';

const { now } = require('../shared/utils');
const { DEFAULT_SETTINGS } = require('./settings-defaults');
const settingsMigrations = require('./settings-migrations');

function createSettingsStore(db) {
  // Initialize defaults into DB on first call
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (key === 'desktopLyricKaraokeMode') {
      const existingMode = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(key);
      if (!existingMode) {
        const legacyEnabled = db
          .prepare('SELECT value FROM settings WHERE key = ?')
          .get('desktopLyricKaraokeEnabled');
        const initialMode = legacyEnabled?.value === 'false' ? 'off' : value;
        db.prepare(
          `
          INSERT INTO settings (key, value, updated_at)
          VALUES (?, ?, ?)
        `,
        ).run(key, initialMode, now());
      }
      continue;
    }
    db.prepare(
      `
      INSERT OR IGNORE INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `,
    ).run(key, value, now());
  }

  let cache = null;
  const writeSetting = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  function getSettings() {
    if (cache) return { ...cache };
    const rows = db.prepare('SELECT key, value FROM settings').all();
    cache = { ...DEFAULT_SETTINGS };
    for (const row of rows) cache[row.key] = row.value;
    return { ...cache };
  }

  return {
    getDefaultSettings() {
      return { ...DEFAULT_SETTINGS };
    },

    getSettings,

    setSetting(key, value) {
      writeSetting.run(key, value, now());
      cache = null;
    },

    setSettings(values) {
      const previous = getSettings();
      const changes = Object.entries(values).filter(([key, value]) => previous[key] !== value);
      if (changes.length === 0) return [];
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [key, value] of changes) writeSetting.run(key, value, now());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      cache = null;
      return changes.map(([key]) => key);
    },
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  createSettingsStore,
  ...settingsMigrations,
};
