// 编写人：Aurora
// 设置读写。
// 通过 createSettingsStore(db) 初始化，不自动假设全局数据库连接。
'use strict';

const { now } = require('../shared/utils');
const { DEFAULT_SETTINGS } = require('./settings-defaults');
const settingsMigrations = require('./settings-migrations');
const { CLOUD_SONG_SYNC_PENDING_PREFIX } = require('./cloud-song-sync-store');
const { CLOUD_SETTINGS_SYNC_PENDING_PREFIX, createCloudSettingsSyncStore } = require('./cloud-settings-sync-store');
const { hasCloudSettingChanges } = require('../shared/cloud-settings');
const CLOUD_ROOM_ACCOUNT_KEY = 'cloudRoomAccountKey';
const MONITORING_KEYS = ['danmakuMonitoringEnabled', 'giftMonitoringEnabled'];

function reconcileMonitoringSettings(values, previous) {
  const hasChannels = MONITORING_KEYS.some((key) => Object.hasOwn(values, key));
  if (!hasChannels && !Object.hasOwn(values, 'enableBilibili')) return values;
  const legacyChanged = !hasChannels && values.enableBilibili !== previous.enableBilibili;
  const channels = Object.fromEntries(MONITORING_KEYS.map((key) => [
    key, legacyChanged ? values.enableBilibili : (values[key] ?? previous[key]),
  ]));
  return {
    ...values,
    ...channels,
    enableBilibili: String(MONITORING_KEYS.some((key) => channels[key] === 'true')),
  };
}

function bootstrapSettingsStore(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const read = db.prepare('SELECT value FROM settings WHERE key = ?');
    const queueSpeedVersion = read.get('queueScrollSpeedRangeVersion')?.value;
    const fontSizeVersion = read.get('queueFontSizeRangeVersion')?.value;
    const styleVersion = read.get('queueStyleSettingsVersion')?.value;
    const songSpeedVersion = read.get('songScrollSpeedRangeVersion')?.value;
    const songSpeed = read.get('scrollSeconds');
    const settingsStore = createSettingsStore(db);
    settingsMigrations.migrateQueueScrollSpeedSetting(db, queueSpeedVersion);
    if (!songSpeed && !songSpeedVersion) {
      // A new default is already in the current range; persist its checkpoint.
      settingsStore.setSetting('songScrollSpeedRangeVersion', '2');
    } else {
      settingsMigrations.migrateSongScrollSpeedSetting(db, songSpeedVersion);
    }
    settingsMigrations.migrateQueueFontSizeSettings(db, fontSizeVersion);
    settingsMigrations.migrateQueueStyleSettings(db, styleVersion);
    settingsMigrations.migrateSongBoardFontSizeSetting(db);
    settingsMigrations.clearLegacyIdentityRuleDefaults(db);
    settingsMigrations.migrateBlindBoxConfig(db);
    settingsStore.setSetting('openingEnabled', 'false');
    db.exec('COMMIT');
    return settingsStore;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createSettingsStore(db) {
  const legacyMonitoring = db.prepare('SELECT value FROM settings WHERE key = ?').get('enableBilibili')?.value;
  // Initialize defaults into DB on first call
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (key === 'desktopLyricKaraokeMode') {
      const existingMode = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (!existingMode) {
        const legacyEnabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('desktopLyricKaraokeEnabled');
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
    ).run(key, MONITORING_KEYS.includes(key) ? (legacyMonitoring ?? value) : value, now());
  }

  let cache = null;
  const cloudSync = createCloudSettingsSyncStore(db);
  const writeSetting = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const combinedMonitoring = String(MONITORING_KEYS.some((key) => readSetting.get(key)?.value === 'true'));
  if (readSetting.get('enableBilibili')?.value !== combinedMonitoring) {
    writeSetting.run('enableBilibili', combinedMonitoring, now());
  }

  function getSettings() {
    if (cache) return { ...cache };
    const rows = db.prepare('SELECT key, value FROM settings').all();
    cache = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key === CLOUD_ROOM_ACCOUNT_KEY || row.key.startsWith(CLOUD_SONG_SYNC_PENDING_PREFIX)
        || row.key.startsWith(CLOUD_SETTINGS_SYNC_PENDING_PREFIX)) continue;
      cache[row.key] = row.value;
    }
    return { ...cache };
  }

  function setSettings(values, { syncPending = true } = {}) {
    const previous = getSettings();
    const changes = Object.entries(reconcileMonitoringSettings(values, previous))
      .filter(([key, value]) => previous[key] !== value);
    if (changes.length === 0) return [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, value] of changes) writeSetting.run(key, value, now());
      if (syncPending && hasCloudSettingChanges(changes.map(([key]) => key))) {
        cloudSync.capturePending({ ...previous, ...Object.fromEntries(changes) });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    cache = null;
    return changes.map(([key]) => key);
  }

  return {
    getDefaultSettings() {
      return { ...DEFAULT_SETTINGS };
    },

    getSettings,
    getPendingCloudSettings: cloudSync.readPending,
    acknowledgePendingCloudSettings: cloudSync.acknowledge,

    prepareCloudRoomAccount(accountKey) {
      const owner = db.prepare('SELECT value FROM settings WHERE key = ?').get(CLOUD_ROOM_ACCOUNT_KEY)?.value;
      if (owner === accountKey) return false;
      // Ownership and detachment must survive a crash as one change.
      db.exec('BEGIN IMMEDIATE');
      try {
        writeSetting.run('roomId', '', now());
        writeSetting.run(CLOUD_ROOM_ACCOUNT_KEY, accountKey, now());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      cache = null;
      return true;
    },

    setSetting(key, value) {
      if (hasCloudSettingChanges([key])) {
        setSettings({ [key]: value });
        return;
      }
      writeSetting.run(key, value, now());
      cache = null;
    },

    setSettings,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  createSettingsStore,
  bootstrapSettingsStore,
  ...settingsMigrations,
};
