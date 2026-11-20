'use strict';

const { readGiftDisplaySettings } = require('../bilibili/gift/display-settings');
const { buildGiftCards } = require('../../public/js/shared/gift-card-model.js');
const { shanghaiToday } = require('../../public/js/shared/gift-feed-state.js');
const { createGiftCardRuntime } = require('./gift-card-runtime');
const { normalizeGiftCardAvatarResult, GIFT_CARD_AVATAR_BATCH_SIZE } = require('../shared/gift-card-profiles');

async function completeExportAvatars(items, profiles, readAvatars, assertCurrent) {
  if (!readAvatars) return items;
  const missing = new Set(items.filter((item) => !item.gift.avatarUrl).map((item) => item.eventId));
  if (!missing.size) return items;
  for (const profile of profiles?.items || []) {
    if (profile.senderId && profile.avatarUrl) missing.delete(profile.eventId);
    if (!missing.size) return items;
  }
  const unresolved = [...missing];
  const avatars = new Map();
  const signal = AbortSignal.timeout(4000);
  for (let start = 0; start < unresolved.length; start += GIFT_CARD_AVATAR_BATCH_SIZE) {
    const eventIds = unresolved.slice(start, start + GIFT_CARD_AVATAR_BATCH_SIZE);
    try {
      signal.throwIfAborted();
      const result = await readAvatars({ eventIds, signal });
      for (const { eventId, avatarUrl } of normalizeGiftCardAvatarResult(result, eventIds)) {
        avatars.set(eventId, avatarUrl);
      }
    } catch {
      // Older servers and network failures can still export with the saved evidence.
      break;
    }
    assertCurrent();
  }
  if (!avatars.size) return items;
  return items.map((item) => avatars.has(item.eventId)
    ? { ...item, gift: { ...item.gift, avatarUrl: avatars.get(item.eventId) } }
    : item);
}

// Local gift facade for source selection, sync callbacks, shared cards and export preparation/settings.
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
      // Source recovery and activated history can reveal records without changing viewEpoch.
      if (
        previous?.viewEpoch !== next?.viewEpoch ||
        (previous?.syncState === 'SOURCE_SWITCHING' && next?.syncState !== 'SOURCE_SWITCHING') ||
        (previous?.syncState === 'BOOTSTRAPPING' && next?.syncState === 'CATCHING_UP')
      ) {
        broadcastSnapshot('gift:source');
      }
      return next;
    },
    getGiftViewRevision: () => getServices().gifts.getViewRevision(),
    async prepareGiftExport(selection) {
      const services = getServices();
      const snapshot = services.gifts.getSelection(selection);
      const day = shanghaiToday();
      const assertCurrent = () => {
        if (services.gifts.getViewRevision() !== snapshot.viewRevision || shanghaiToday() !== day) {
          throw Object.assign(new Error('礼物来源或流水已变更，请重新选择。'), { code: 'GIFT_VIEW_STALE' });
        }
      };
      const profiles = await cards.getProfiles(snapshot.viewRevision);
      assertCurrent();
      const items = await completeExportAvatars(snapshot.items, profiles, sync.cardAvatars, assertCurrent);
      assertCurrent();
      return {
        ...snapshot,
        items: buildGiftCards(items, profiles ? { day: profiles.day, profiles: profiles.items } : {}),
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
