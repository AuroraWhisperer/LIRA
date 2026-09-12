'use strict';

const defaultSettingsStoreModule = require('../storage/settings-store');

function prepareSettingsBootstrap(songDb, settingsStoreModule) {
  const storeModule = settingsStoreModule || defaultSettingsStoreModule;
  return { settingsStore: storeModule.bootstrapSettingsStore(songDb) };
}

module.exports = { prepareSettingsBootstrap };
