'use strict';

const { readGiftDisplaySettings } = require('../bilibili/gift/display-settings');
const { buildGiftCards } = require('../../public/js/shared/gift-card-model.js');
const { createGiftCardRuntime } = require('./gift-card-runtime');

function createGiftExportRuntime({ getServices, getSettingsStore, broadcastSnapshot, giftCards, getUserAvatar }) {
  let sync = {};
  const cards =
    giftCards ||
    createGiftCardRuntime({
      getGifts: () => getServices().gifts,
      fetchPage: (request) => sync.cardProfiles?.(request),
      ensureAvatar: getUserAvatar,
    });
  return {
    giftCards: cards,
    configureGiftSync(options) {
      sync = options || {};
      cards.reset?.();
    },
    rebuildGiftProjection: () => (typeof sync.rebuild === 'function' ? sync.rebuild() : false),
    clearRemoteGiftHistory() {
      if (typeof sync.clearRemote !== 'function') throw new Error('REMOTE_GIFT_CLEAR_UNAVAILABLE');
      return sync.clearRemote();
    },
    setActiveGiftSource(source) {
      const gifts = getServices()?.gifts;
      if (!gifts) throw new Error('Gift service not ready.');
      const previous = gifts.getActiveSource();
      const next = gifts.setActiveSource(source);
      // Leaving source switching makes cached gifts readable without changing viewEpoch.
      if (
        previous?.viewEpoch !== next?.viewEpoch ||
        (previous?.syncState === 'SOURCE_SWITCHING' && next?.syncState !== 'SOURCE_SWITCHING')
      ) {
        broadcastSnapshot('gift:source');
      }
      return next;
    },
    getGiftViewRevision: () => getServices().gifts.getViewRevision(),
    async prepareGiftExport(selection) {
      const services = getServices();
      const snapshot = services.gifts.getSelection(selection);
      const profiles = await cards.getProfiles(snapshot.viewRevision);
      if (services.gifts.getViewRevision() !== snapshot.viewRevision) {
        throw Object.assign(new Error('礼物来源或流水已变更，请重新选择。'), { code: 'GIFT_VIEW_STALE' });
      }
      return {
        ...snapshot,
        items: buildGiftCards(snapshot.items, profiles ? { day: profiles.day, profiles: profiles.items } : {}),
        selectedCount: snapshot.items.length,
        cardsPartial: profiles?.partial === true,
        config: readGiftDisplaySettings(getSettingsStore().getSettings()),
        catalog: structuredClone(services.overtimeGiftCatalog.getGlobalSnapshot()?.gifts || []),
      };
    },
    setGiftExportDirectory: (directory) => getSettingsStore().setSetting('giftExportDirectory', directory),
    setGiftExportSettings: ({ mode, background, directory }) =>
      getSettingsStore().setSettings({
        giftExportMode: mode,
        giftExportBackground: background,
        giftExportDirectory: directory,
      }),
  };
}

module.exports = { createGiftExportRuntime };
