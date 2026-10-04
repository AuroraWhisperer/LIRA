'use strict';

const { projectOverlayState, projectOverlayResponse } = require('./overlay-projection');
const { scanTodayGifts, shanghaiToday } = require('../../public/js/shared/gift-feed-state.js');
const { buildGiftCards } = require('../../public/js/shared/gift-card-model.js');
const { getOpeningConfig } = require('./routes/opening-routes');

function createSceneExtraDisplay({ getContext, getOwner, now = Date.now }) {
  // Slow gift/profile reads are shared across canvas instances and source polls.
  const cache = new Map();
  function cached(type, context, read) {
    const owner = getOwner();
    let revision;
    try { revision = context.gifts.getViewRevision(); }
    catch (error) {
      if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) return null;
      throw error;
    }
    const day = shanghaiToday(now());
    const key = JSON.stringify([owner?.scope, owner?.epoch, revision, day]);
    const current = cache.get(type);
    if (current?.key === key && (current.pending || now() - current.at < 5000)) return current.promise;
    const entry = { key, pending: true, at: now() };
    entry.promise = Promise.resolve().then(read).then((value) => {
      if (context.gifts.getViewRevision() !== revision || shanghaiToday(now()) !== day) return null;
      return value;
    }).catch((error) => {
      if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) return null;
      throw error;
    }).finally(() => { entry.pending = false; entry.at = now(); });
    cache.set(type, entry);
    return entry.promise;
  }
  return function getExtraDisplay(type) {
    const context = getContext();
    const response = (path, value) => projectOverlayResponse(type, path, value);
    switch (type) {
      case 'opening': return response('/api/opening/config', getOpeningConfig(context));
      case 'songlist': return { songs: response('/api/songs', context.songs.list({ enabledOnly: true })) };
      case 'lyrics': {
        const { lyricState, lyricTimeline } = projectOverlayState(type, context.system.getState());
        return { lyricState, lyricTimeline };
      }
      case 'games': return { session: response('/api/games/session', context.games.getSession()) };
      case 'wheel': return response('/api/wheel', context.wheel.getState());
      case 'interactions': return response('/api/interactions/session', context.interactions.getState());
      case 'blindbox':
        try { return response('/api/gifts/blind-box-stats', context.gifts.getBlindBoxStats({})); }
        catch (error) {
          if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) return null;
          throw error;
        }
      case 'gift-wishes': return cached(type, context, async () => response('/api/gifts/wishes', await context.giftWishes.getSnapshot()));
      case 'gift-feed': return cached(type, context, async () => {
        const day = shanghaiToday(now());
        const result = await scanTodayGifts({ day, onRevision() {}, request: async (url) => {
          const query = new URL(url, 'http://localhost').searchParams;
          return response('/api/gifts/history', context.gifts.getHistory({ range: 'today', startDate: day, endDate: day,
            limit: 100, sortField: 'created_at', sortDirection: 'asc', cursor: query.get('cursor'),
            ...(query.has('viewRevision') ? { viewRevision: query.get('viewRevision') } : {}) }));
        } });
        const profiles = await context.giftCards.getProfiles(result.viewRevision);
        if (profiles.day !== day || profiles.viewRevision !== result.viewRevision) {
          throw Object.assign(new Error('礼物来源或日期已变化。'), { code: 'GIFT_VIEW_STALE' });
        }
        const catalog = response('/api/overtime/gifts/catalog', context.overtime.getGlobalGiftCatalog());
        return { items: buildGiftCards(result.items, { day, profiles: profiles.items }), catalog: catalog?.gifts || [], day,
          viewRevision: result.viewRevision };
      });
      default: return null;
    }
  };
}

module.exports = { createSceneExtraDisplay };
