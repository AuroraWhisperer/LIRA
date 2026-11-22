'use strict';

const { readGiftDisplaySettings } = require('../bilibili/gift/display-settings');
const { buildGiftCards, addGiftCardTotals } = require('../../public/js/shared/gift-card-model.js');
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

// Only the first selected event of a confirmed daily card is needed as identity evidence.
async function mergeGiftExport(snapshot, readGroups, signal) {
  const byGift = new Map();
  for (const item of snapshot.items) {
    const { giftId, giftName } = item.gift;
    if (!giftId || !giftName) continue;
    const key = JSON.stringify([giftId, giftName]);
    if (!byGift.has(key)) byGift.set(key, []);
    byGift.get(key).push(item.sourceEventId ?? item.eventId);
  }
  const eventIds = [...byGift.values()].filter(ids => ids.length > 1).flat();
  if (!eventIds.length) return snapshot;
  const groups = new Map();
  let partial;
  try {
    const result = await readGroups({ eventIds, signal });
    if (result?.ok !== true || typeof result.partial !== 'boolean' || !Array.isArray(result.groups)) {
      throw new Error('INVALID_GIFT_CARD_GROUPS');
    }
    const remaining = new Set(eventIds);
    for (const group of result.groups) {
      if (!Array.isArray(group) || group.length < 2) throw new Error('INVALID_GIFT_CARD_GROUPS');
      for (const id of group) {
        if (!remaining.delete(id)) throw new Error('INVALID_GIFT_CARD_GROUPS');
        groups.set(id, group);
      }
    }
    partial = result.partial;
  } catch {
    signal.throwIfAborted();
    return { ...snapshot, cardsPartial: true };
  }
  const items = [];
  const merged = new Map();
  for (const item of snapshot.items) {
    const group = groups.get(item.sourceEventId ?? item.eventId);
    if (!group) {
      items.push(item);
    } else if (merged.has(group)) {
      const card = merged.get(group);
      if (card.gift.giftId !== item.gift.giftId || card.gift.giftName !== item.gift.giftName) {
        return { ...snapshot, cardsPartial: true };
      }
      addGiftCardTotals(card, item);
    } else {
      const card = { ...item, gift: { ...item.gift } };
      merged.set(group, card);
      items.push(card);
    }
  }
  return { ...snapshot, items, cardsPartial: partial };
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
        items: buildGiftCards(items, { day: profiles?.day, profiles: profiles?.items, keepSourceEventId: true }),
        selectedCount: snapshot.items.length,
        cardsPartial: profiles?.partial === true,
        config: readGiftDisplaySettings(getSettingsStore().getSettings()),
        catalog: structuredClone(services.overtimeGiftCatalog.getGlobalSnapshot()?.gifts || []),
      };
    },
    mergeGiftExport: (snapshot, signal) => mergeGiftExport(snapshot, sync.cardGroups, signal),
    setGiftExportDirectory: (directory) => getSettingsStore().setSetting('giftExportDirectory', directory),
    setGiftExportSettings: ({ mode, background, mergeAcrossDates, directory }) =>
      getSettingsStore().setSettings({
        giftExportMode: mode,
        giftExportBackground: background,
        giftExportMergeAcrossDates: String(mergeAcrossDates),
        giftExportDirectory: directory,
      }),
  };
}

module.exports = { createGiftExportRuntime };
