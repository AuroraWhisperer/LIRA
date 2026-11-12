// 编写人：Aurora
// 设置读写。
// 通过 createSettingsStore(db) 初始化，不自动假设全局数据库连接。
'use strict';

const { now } = require('../shared/utils');
const { DEFAULT_SETTINGS } = require('./settings-defaults');
const settingsMigrations = require('./settings-migrations');
const { CLOUD_SONG_ACCOUNT_KEY, CLOUD_SONG_SYNC_PENDING_PREFIX, createCloudSongSyncStore } = require('./cloud-song-sync-store');
const { CLOUD_SETTINGS_ACCOUNT_KEY, CLOUD_SETTINGS_SYNC_PENDING_PREFIX, createCloudSettingsSyncStore } = require('./cloud-settings-sync-store');
const { CLOUD_BILIBILI_LOGOUT_PENDING_PREFIX, createCloudBilibiliSyncStore } = require('./cloud-bilibili-sync-store');
const { CLOUD_SYNC_KEYS, hasCloudSettingChanges } = require('../shared/cloud-settings');
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
    const identityRuleDefaultsVersion = read.get('identityRuleDefaultsVersion')?.value;
    const songSpeedVersion = read.get('songScrollSpeedRangeVersion')?.value;
    const songSpeed = read.get('scrollSeconds');
    // Migrate only persisted legacy fonts, before inserting current defaults.
    settingsMigrations.migrateQueueFontSizeSettings(db, fontSizeVersion);
    settingsMigrations.migrateIdentityQueueFontFamily(db);
    const settingsStore = createSettingsStore(db);
    settingsMigrations.migrateQueueScrollSpeedSetting(db, queueSpeedVersion);
    if (!songSpeed && !songSpeedVersion) {
      // A new default is already in the current range; persist its checkpoint.
      settingsStore.setSetting('songScrollSpeedRangeVersion', '2');
    } else {
      settingsMigrations.migrateSongScrollSpeedSetting(db, songSpeedVersion);
    }
    settingsMigrations.migrateQueueStyleSettings(db, styleVersion);
    if (identityRuleDefaultsVersion !== '1') {
      if (styleVersion !== '1') settingsMigrations.clearLegacyIdentityRuleDefaults(db);
      settingsStore.setSetting('identityRuleDefaultsVersion', '1');
    }
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
  let roomRevision = 0;
  const cloudSync = createCloudSettingsSyncStore(db);
  const cloudSongs = createCloudSongSyncStore(db);
  const cloudBilibili = createCloudBilibiliSyncStore(db);
  const writeSetting = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const combinedMonitoring = String(MONITORING_KEYS.some((key) => readSetting.get(key)?.value === 'true'));
  if (readSetting.get('enableBilibili')?.value !== combinedMonitoring) {
    writeSetting.run('enableBilibili', combinedMonitoring, now());
  }

  function getSettings(keys) {
    if (!cache) {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      cache = { ...DEFAULT_SETTINGS };
      for (const row of rows) {
        if (row.key === CLOUD_ROOM_ACCOUNT_KEY || row.key === CLOUD_SONG_ACCOUNT_KEY || row.key === CLOUD_SETTINGS_ACCOUNT_KEY || row.key.startsWith(CLOUD_SONG_SYNC_PENDING_PREFIX)
          || row.key.startsWith(CLOUD_SETTINGS_SYNC_PENDING_PREFIX) || row.key.startsWith(CLOUD_BILIBILI_LOGOUT_PENDING_PREFIX)) continue;
        cache[row.key] = row.value;
      }
    }
    return keys
      ? Object.fromEntries(keys.filter(key => Object.hasOwn(cache, key)).map(key => [key, cache[key]]))
      : { ...cache };
  }

  function setSettings(values, { syncPending = true, accountKey } = {}) {
    const previous = getSettings();
    const owner = accountKey && readSetting.get(CLOUD_SETTINGS_ACCOUNT_KEY)?.value;
    if (accountKey && owner !== undefined && owner !== accountKey) {
      // Old servers may omit optional controls; never inherit them from another account.
      const defaults = Object.fromEntries(CLOUD_SYNC_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]]));
      for (const key of MONITORING_KEYS) defaults[key] = values.enableBilibili ?? defaults[key];
      values = { ...defaults, ...values };
    }
    const changes = Object.entries(reconcileMonitoringSettings(values, previous))
      .filter(([key, value]) => previous[key] !== value);
    if (changes.length === 0 && !accountKey) return [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, value] of changes) writeSetting.run(key, value, now());
      if (accountKey) cloudSync.acceptAccount(accountKey);
      if (syncPending && hasCloudSettingChanges(changes.map(([key]) => key))) {
        cloudSync.capturePending({ ...previous, ...Object.fromEntries(changes) });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    cache = null;
    if (changes.some(([key]) => key === 'roomId')) roomRevision += 1;
    return changes.map(([key]) => key);
  }

  return {
    getDefaultSettings() {
      return { ...DEFAULT_SETTINGS };
    },

    getSettings,
    getRoomRevision: () => roomRevision,
    getPendingCloudSettings: cloudSync.readPending,
    acknowledgePendingCloudSettings: cloudSync.acknowledge,
    assertCloudSettingsAccount: cloudSync.assertAccount,
    acceptCloudSettingsAccount: cloudSync.acceptAccount,
    capturePendingCloudBilibiliLogout: cloudBilibili.captureLogout,
    getPendingCloudBilibiliLogout: cloudBilibili.readLogout,
    acknowledgePendingCloudBilibiliLogout: cloudBilibili.acknowledgeLogout,

    prepareCloudRoomAccount(accountKey) {
      const owner = db.prepare('SELECT value FROM settings WHERE key = ?').get(CLOUD_ROOM_ACCOUNT_KEY)?.value;
      if (owner === accountKey) {
        cloudSongs.initializeAccount(accountKey);
        cloudSync.initializeAccount(accountKey);
        return false;
      }
      const previousRoomId = getSettings().roomId;
      // Ownership and detachment must survive a crash as one change.
      db.exec('BEGIN IMMEDIATE');
      try {
        // Keep the library's existing owner while the next account is restored.
        cloudSongs.initializeAccount(owner || accountKey);
        cloudSync.initializeAccount(owner || accountKey);
        // Detaching the room invalidates this snapshot even if that account returns next.
        if (owner) cloudSync.acceptAccount('');
        writeSetting.run('roomId', '', now());
        writeSetting.run(CLOUD_ROOM_ACCOUNT_KEY, accountKey, now());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      cache = null;
      if (previousRoomId) roomRevision += 1;
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
