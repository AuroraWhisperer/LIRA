'use strict';

const { randomUUID } = require('node:crypto');
const { projectOverlayState, projectOverlayResponse } = require('./overlay-projection');
const { scanTodayGifts, shanghaiToday } = require('../../public/js/shared/gift-feed-state.js');
const { buildGiftCards } = require('../../public/js/shared/gift-card-model.js');
const { getOpeningConfig } = require('./opening-service');

function createSceneExtraDisplay({ displayPorts, getOwner, now = Date.now }) {
  // Slow gift/profile reads are shared across canvas instances and source polls.
  const cache = new Map();
  let feedSnapshot = null;
  let catalogVersion = 0;
  function cached(type, read) {
    const owner = getOwner();
    let revision;
    try { revision = displayPorts.gifts.getViewRevision(); }
    catch (error) {
      if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) return null;
      throw error;
    }
    const day = shanghaiToday(now());
    const key = JSON.stringify([owner?.scope, owner?.epoch, revision, day]);
    const current = cache.get(type);
    if (current?.key === key && (current.pending || now() - current.at < 5000)) return current.promise;
    const entry = { key, pending: true, at: now() };
    entry.promise = Promise.resolve().then(() => read(key)).then((value) => {
      if (displayPorts.gifts.getViewRevision() !== revision || shanghaiToday(now()) !== day) return null;
      return value;
    }).catch((error) => {
      if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) return null;
      throw error;
    }).finally(() => { entry.pending = false; entry.at = now(); });
    cache.set(type, entry);
    return entry.promise;
  }
  function unchanged(request, key, version) {
    if (!request?.dataVersions) return false;
    request.dataVersions.current[key] = version;
    return request.dataVersions.known[key] === version;
  }
  function getExtraDisplay(type, getState, request) {
    getState ??= () => displayPorts.system.getState();
    const response = (path, value) => projectOverlayResponse(type, path, value);
    switch (type) {
      case 'gift-sprint': return projectOverlayState(type, getState()).giftSprint ?? null;
      case 'opening': return response('/api/opening/config', getOpeningConfig(displayPorts));
      case 'songlist': {
        const owner = getOwner?.();
        const revision = displayPorts.songs.getChangeToken?.();
        const key = JSON.stringify([owner?.scope, owner?.epoch, revision]);
        let entry = cache.get(type);
        if (revision === undefined || entry?.key !== key) {
          entry = { key, version: randomUUID(), songs: response('/api/songs', displayPorts.songs.list({ enabledOnly: true })) };
          if (revision !== undefined) cache.set(type, entry);
        }
        return unchanged(request, type, entry.version) ? undefined : { songs: structuredClone(entry.songs) };
      }
      case 'lyrics': {
        const state = getState();
        const owner = getOwner?.();
        const key = JSON.stringify([owner?.scope, owner?.epoch]);
        let entry = cache.get(type);
        if (!entry || entry.key !== key || entry.source !== state.lyricTimeline) {
          entry = { key, source: state.lyricTimeline, version: randomUUID(),
            timeline: projectOverlayState(type, { lyricTimeline: state.lyricTimeline }).lyricTimeline };
          cache.set(type, entry);
        }
        const { lyricState } = projectOverlayState(type, { lyricState: state.lyricState });
        return { lyricState, ...(unchanged(request, 'lyricTimeline', entry.version)
          ? {} : { lyricTimeline: structuredClone(entry.timeline) }) };
      }
      case 'games': return { session: response('/api/games/session', displayPorts.games.getSession()) };
      case 'wheel': return response('/api/wheel', displayPorts.wheel.getState());
      case 'interactions': return response('/api/interactions/session', displayPorts.interactions.getState());
      case 'blindbox':
        try { return response('/api/gifts/blind-box-stats', displayPorts.gifts.getBlindBoxStats(
          displayPorts.settings.get().blindboxHeartBoxOnly === 'true' ? { boxName: '心动盲盒' } : {})); }
        catch (error) {
          if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) return null;
          throw error;
        }
      case 'gift-wishes': return cached(type, async () => response('/api/gifts/wishes', await displayPorts.giftWishes.getSnapshot()));
      case 'gift-feed': return Promise.resolve(cached(type, async (key) => {
        const previous = feedSnapshot?.key === key ? feedSnapshot : null;
        const currentCatalogVersion = catalogVersion;
        const day = shanghaiToday(now());
        const result = await scanTodayGifts({ day, previous: previous?.history, onRevision() {}, request: async (url) => {
          const query = new URL(url, 'http://localhost').searchParams;
          return response('/api/gifts/history', displayPorts.gifts.getHistory({ range: 'today', startDate: day, endDate: day,
            limit: 100, sortField: 'created_at', sortDirection: 'asc', cursor: query.get('cursor'),
            conditional: true,
            ...(query.has('contentRevision') ? { contentRevision: query.get('contentRevision') } : {}),
            ...(query.has('viewRevision') ? { viewRevision: query.get('viewRevision') } : {}) }));
        } });
        const profiles = await displayPorts.giftCards.getProfiles(result.viewRevision);
        if (profiles.day !== day || profiles.viewRevision !== result.viewRevision) {
          throw Object.assign(new Error('礼物来源或日期已变化。'), { code: 'GIFT_VIEW_STALE' });
        }
        const catalog = previous?.catalogVersion === currentCatalogVersion ? previous.value.catalog
          : response('/api/overtime/gifts/catalog', displayPorts.overtime.getGlobalGiftCatalog())?.gifts || [];
        const items = profiles.contentRevision && previous?.profilesRevision === profiles.contentRevision && previous.history.items === result.items
          ? previous.value.items : buildGiftCards(result.items, { day, profiles: profiles.items });
        const value = { items, catalog, day, viewRevision: result.viewRevision };
        const version = previous?.value.items === items && previous.value.catalog === catalog ? previous.version : randomUUID();
        const owner = getOwner();
        if (key !== JSON.stringify([owner?.scope, owner?.epoch, displayPorts.gifts.getViewRevision(), shanghaiToday(now())])) return null;
        feedSnapshot = { key, history: result, profilesRevision: profiles.contentRevision, catalogVersion: currentCatalogVersion, value, version };
        return feedSnapshot;
      })).then((entry) => entry ? (unchanged(request, type, entry.version) ? undefined : entry.value) : null);
      default: return null;
    }
  }
  getExtraDisplay.invalidate = (types) => {
    if (types.includes('gift-feed')) catalogVersion += 1;
    for (const type of types) cache.delete(type);
  };
  return getExtraDisplay;
}

module.exports = { createSceneExtraDisplay };
