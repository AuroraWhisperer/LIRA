'use strict';

function prepareSettingsBootstrap(songDb, settingsStoreModule) {
  const queueScrollSpeedRangeVersion = songDb.prepare(`
    SELECT value
    FROM settings
    WHERE key = 'queueScrollSpeedRangeVersion'
  `).get();
  const queueFontSizeRangeVersion = songDb.prepare(`
    SELECT value
    FROM settings
    WHERE key = 'queueFontSizeRangeVersion'
  `).get();
  const songScrollSpeedRow = songDb.prepare(`
    SELECT value
    FROM settings
    WHERE key = 'scrollSeconds'
  `).get();
  const songScrollSpeedRangeVersion = songDb.prepare(`
    SELECT value
    FROM settings
    WHERE key = 'songScrollSpeedRangeVersion'
  `).get();
  const settingsStore = settingsStoreModule.createSettingsStore(songDb);

  function runMigrations() {
    settingsStoreModule.migrateQueueScrollSpeedSetting(
      songDb,
      queueScrollSpeedRangeVersion && queueScrollSpeedRangeVersion.value
    );
    settingsStoreModule.migrateSongScrollSpeedSetting(
      songDb,
      songScrollSpeedRangeVersion && songScrollSpeedRangeVersion.value
        ? songScrollSpeedRangeVersion.value
        : songScrollSpeedRow ? '' : '2'
    );
    settingsStoreModule.migrateQueueFontSizeSettings(
      songDb,
      queueFontSizeRangeVersion && queueFontSizeRangeVersion.value
    );
    settingsStoreModule.migrateSongBoardFontSizeSetting(songDb);
    settingsStoreModule.clearLegacyIdentityRuleDefaults(songDb);
    settingsStoreModule.migrateBlindBoxConfig(songDb);
  }

  return { settingsStore, runMigrations };
}

module.exports = { prepareSettingsBootstrap };

