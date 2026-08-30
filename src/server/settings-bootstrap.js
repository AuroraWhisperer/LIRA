'use strict';

const { createSettingsStore } = require('../storage/settings-store');
const settingsMigrations = require('../storage/settings-migrations');

const DEFAULT_SETTINGS_STORE_MODULE = {
  createSettingsStore,
  ...settingsMigrations,
};

function prepareSettingsBootstrap(songDb, settingsStoreModule) {
  const storeModule = settingsStoreModule || DEFAULT_SETTINGS_STORE_MODULE;
  const queueScrollSpeedRangeVersion = songDb
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'queueScrollSpeedRangeVersion'
  `,
    )
    .get();
  const queueFontSizeRangeVersion = songDb
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'queueFontSizeRangeVersion'
  `,
    )
    .get();
  const queueStyleSettingsVersion =
    storeModule.getQueueStyleSettingsVersion(songDb);
  const songScrollSpeedRow = songDb
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'scrollSeconds'
  `,
    )
    .get();
  const songScrollSpeedRangeVersion = songDb
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'songScrollSpeedRangeVersion'
  `,
    )
    .get();
  const settingsStore = storeModule.createSettingsStore(songDb);

  function runMigrations() {
    storeModule.migrateQueueScrollSpeedSetting(
      songDb,
      queueScrollSpeedRangeVersion && queueScrollSpeedRangeVersion.value,
    );
    storeModule.migrateSongScrollSpeedSetting(
      songDb,
      songScrollSpeedRangeVersion && songScrollSpeedRangeVersion.value
        ? songScrollSpeedRangeVersion.value
        : songScrollSpeedRow
          ? ''
          : '2',
    );
    storeModule.migrateQueueFontSizeSettings(
      songDb,
      queueFontSizeRangeVersion && queueFontSizeRangeVersion.value,
    );
    storeModule.migrateQueueStyleSettings(songDb, queueStyleSettingsVersion);
    storeModule.migrateSongBoardFontSizeSetting(songDb);
    storeModule.clearLegacyIdentityRuleDefaults(songDb);
    storeModule.migrateBlindBoxConfig(songDb);
  }

  runMigrations();
  settingsStore.setSetting('openingEnabled', 'false');
  return { settingsStore };
}

module.exports = { prepareSettingsBootstrap };
