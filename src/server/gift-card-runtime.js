'use strict';

const { normalizeGiftCardProfilePage } = require('../shared/gift-card-profiles');
const { normalizeGiftDisplayProfile } = require('../shared/processed-gift-contract');

function createGiftCardRuntime({ getGifts, fetchPage, ensureAvatar, now = Date.now }) {
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
      let result;
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
        result = { viewRevision, day, items, partial: false };
      } catch (error) {
        assertCurrent();
        if (error.code === 'GIFT_VIEW_STALE') throw error;
        result = { ...(cached?.result || { viewRevision, day, items: [] }), partial: true };
      }
      result.items = await resolveAvatars(result.items, cached?.result.items || [], assertCurrent);
      assertCurrent();
      cached = { key, result };
      return result;
    })();
    pending = { key, promise };
    try { return await promise; }
    finally { if (pending?.promise === promise) pending = null; }
  }

  async function resolveAvatars(items, previous, assertCurrent) {
    const avatars = new Map();
    for (const item of [...previous, ...[...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))]) {
      if (item.senderId && item.avatarUrl) avatars.set(item.senderId, item.avatarUrl);
    }
    const missing = [...new Set(items.map((item) => item.senderId))]
      .filter((uid) => uid && /^[1-9]\d{0,19}$/.test(uid) && !avatars.has(uid));
    if (ensureAvatar && missing.length) {
      let index = 0;
      let expired = false;
      let timer;
      const workers = Array.from({ length: Math.min(4, missing.length) }, async () => {
        while (!expired && index < missing.length) {
          assertCurrent();
          const uid = missing[index++];
          try {
            const avatarUrl = await ensureAvatar(uid);
            assertCurrent();
            if (avatarUrl) {
              const display = normalizeGiftDisplayProfile({ version: 1, avatarUrl, guardLevel: null },
                () => new Error('INVALID_GIFT_AVATAR'));
              avatars.set(uid, display.avatarUrl);
            }
          } catch (error) {
            if (error.code === 'GIFT_VIEW_STALE') throw error;
          }
        }
      });
      try {
        // Slow lookups finish in the user-info cache; the next read can reuse them.
        await Promise.race([Promise.all(workers), new Promise((resolve) => {
          timer = setTimeout(() => { expired = true; resolve(); }, 4000);
        })]);
      } finally {
        expired = true;
        clearTimeout(timer);
      }
    }
    return items.map((item) => ({ ...item, avatarUrl: avatars.get(item.senderId) || item.avatarUrl }));
  }

  return { getProfiles, reset() { generation += 1; cached = null; pending = null; } };
}

module.exports = { createGiftCardRuntime };
