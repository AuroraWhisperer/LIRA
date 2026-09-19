'use strict';

const { normalizeGiftCardProfilePage } = require('../shared/gift-card-profiles');

function createGiftCardRuntime({ getGifts, fetchPage, now = Date.now }) {
  let cached = null;
  let pending = null;
  let generation = 0;
  const today = () => new Date(now() + 28800000).toISOString().slice(0, 10);
  const stale = () => Object.assign(new Error('礼物来源或日期已变更，请重试。'), { code: 'GIFT_VIEW_STALE' });

  async function getProfiles(expectedRevision) {
    const viewRevision = getGifts().getViewRevision();
    const day = today();
    if (expectedRevision && expectedRevision !== viewRevision) throw stale();
    const key = `${viewRevision}:${day}`;
    const current = generation;
    if (cached?.key !== key) cached = null;
    if (pending?.key === key) return pending.promise;
    const assertCurrent = () => {
      if (current !== generation || getGifts().getViewRevision() !== viewRevision || today() !== day) throw stale();
    };
    const promise = (async () => {
      try {
        const items = [];
        const cursors = new Set();
        let cursor = null;
        let syncEpoch = null;
        const signal = AbortSignal.timeout(30000);
        do {
          const page = normalizeGiftCardProfilePage(await fetchPage({ cursor, signal }));
          assertCurrent();
          if (page.day !== day || (syncEpoch && page.syncEpoch !== syncEpoch)) throw stale();
          syncEpoch = page.syncEpoch;
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor)) throw new Error('INVALID_GIFT_CARD_CURSOR');
          cursors.add(cursor);
        } while (cursor);
        const result = { viewRevision, day, items, partial: false };
        cached = { key, result };
        return result;
      } catch (error) {
        assertCurrent();
        if (error.code === 'GIFT_VIEW_STALE') throw error;
        return { ...(cached?.result || { viewRevision, day, items: [] }), partial: true };
      }
    })();
    pending = { key, promise };
    try { return await promise; }
    finally { if (pending?.promise === promise) pending = null; }
  }

  return { getProfiles, reset() { generation += 1; cached = null; pending = null; } };
}

module.exports = { createGiftCardRuntime };
