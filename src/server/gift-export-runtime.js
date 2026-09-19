'use strict';

const { readGiftDisplaySettings } = require('../bilibili/gift/display-settings');

function createGiftExportRuntime({ getServices, getSettingsStore, broadcastSnapshot }) {
  return {
    setActiveGiftSource(source) {
      const gifts = getServices()?.gifts;
      if (!gifts) throw new Error('Gift service not ready.');
      const previous = gifts.getActiveSource();
      const next = gifts.setActiveSource(source);
      if (previous?.viewEpoch !== next?.viewEpoch) broadcastSnapshot('gift:source');
      return next;
    },
    getGiftViewRevision: () => getServices().gifts.getViewRevision(),
    prepareGiftExport(selection) {
      const services = getServices();
      return {
        ...services.gifts.getSelection(selection),
        config: readGiftDisplaySettings(getSettingsStore().getSettings()),
        catalog: structuredClone(services.overtimeGiftCatalog.getGlobalSnapshot()?.gifts || []),
      };
    },
    setGiftExportDirectory: (directory) => getSettingsStore().setSetting('giftExportDirectory', directory),
    setGiftExportSettings: ({ mode, background, directory }) => getSettingsStore().setSettings({
      giftExportMode: mode, giftExportBackground: background, giftExportDirectory: directory,
    }),
  };
}

module.exports = { createGiftExportRuntime };
