'use strict';

const { normalizeGiftCardProfilePage } = require('../shared/gift-card-profiles');
const { normalizeGiftDisplayProfile } = require('../shared/processed-gift-contract');
const { randomUUID } = require('node:crypto');

function createGiftCardRuntime({ getGifts, fetchPage, ensureAvatar, now = Date.now }) {
  let cached = null;
  let pending = null;
  let generation = 0;
  const today = () => new Date(now() + 28800000).toISOString().slice(0, 10);
  const stale = () => Object.assign(new Error('礼物来源或日期已变更，请重试。'), { code: 'GIFT_VIEW_STALE' });

  async function readProfiles(expectedRevision) {
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
      let remoteRevision = cached?.remoteRevision;
      let acceptedEpoch = cached?.syncEpoch;
      try {
        const items = [];
        const cursors = new Set();
        let cursor = null;
        let syncEpoch = null;
        let consistent = true;
        const signal = AbortSignal.timeout(30000);
        do {
          const page = normalizeGiftCardProfilePage(await fetchPage({ cursor, signal,
            ...(!cursor && cached?.remoteRevision ? { revision: cached.remoteRevision } : {}) }));
          assertCurrent();
          if (page.day !== day || (syncEpoch && page.syncEpoch !== syncEpoch)) throw stale();
          syncEpoch = page.syncEpoch;
          if (page.unchanged) {
            if (cursor || !cached?.remoteRevision || page.revision !== cached.remoteRevision || page.syncEpoch !== cached.syncEpoch) throw stale();
            result = { ...cached.result, partial: false };
            break;
          }
          if (!cursor) remoteRevision = page.revision;
          else if (remoteRevision !== page.revision) consistent = false;
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor)) throw new Error('INVALID_GIFT_CARD_CURSOR');
          cursors.add(cursor);
        } while (cursor);
        if (!consistent) remoteRevision = undefined;
        acceptedEpoch = syncEpoch;
        result ??= { viewRevision, day, items, partial: false };
      } catch (error) {
        assertCurrent();
        if (error.code === 'GIFT_VIEW_STALE') throw error;
        result = { ...(cached?.result || { viewRevision, day, items: [] }), partial: true };
        remoteRevision = cached?.remoteRevision;
        acceptedEpoch = cached?.syncEpoch;
      }
      const avatars = result.items === cached?.result.items ? cached.avatars
        : prepareAvatars(result.items, cached?.result.items || []);
      if (avatars.missing.length || avatars.appliedSize < 0) {
        result.items = await resolveAvatars(result.items, avatars, assertCurrent);
      }
      assertCurrent();
      result.contentRevision = result.items === cached?.result.items ? cached.result.contentRevision : randomUUID();
      cached = { key, result, remoteRevision, syncEpoch: acceptedEpoch, avatars };
      return result;
    })();
    pending = { key, promise };
    try {
      return await promise;
    } finally {
      if (pending?.promise === promise) pending = null;
    }
  }

  function prepareAvatars(items, previous) {
    const avatars = new Map();
    for (const item of [...previous, ...[...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))]) {
      if (item.senderId && item.avatarUrl) avatars.set(item.senderId, item.avatarUrl);
    }
    const missing = ensureAvatar ? [...new Set(items.map((item) => item.senderId))].filter(
      (uid) => uid && /^[1-9]\d{0,19}$/.test(uid) && !avatars.has(uid),
    ) : [];
    return { avatars, missing, appliedSize: -1 };
  }

  async function resolveAvatars(items, state, assertCurrent) {
    const { avatars } = state;
    const missing = state.missing.filter(uid => !avatars.has(uid));
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
              const display = normalizeGiftDisplayProfile(
                { version: 1, avatarUrl, guardLevel: null },
                () => new Error('INVALID_GIFT_AVATAR'),
              );
              avatars.set(uid, display.avatarUrl);
            }
          } catch (error) {
            if (error.code === 'GIFT_VIEW_STALE') throw error;
          }
        }
      });
      try {
        // Slow lookups finish in the user-info cache; the next read can reuse them.
        await Promise.race([
          Promise.all(workers),
          new Promise((resolve) => {
            timer = setTimeout(() => {
              expired = true;
              resolve();
            }, 4000);
          }),
        ]);
      } finally {
        expired = true;
        clearTimeout(timer);
      }
    }
    state.missing = missing.filter(uid => !avatars.has(uid));
    if (state.appliedSize === avatars.size) return items;
    state.appliedSize = avatars.size;
    if (items.every((item) => (avatars.get(item.senderId) || item.avatarUrl) === item.avatarUrl)) return items;
    return items.map((item) => ({ ...item, avatarUrl: avatars.get(item.senderId) || item.avatarUrl }));
  }

  return {
    async getProfiles(expectedRevision, contentRevision) {
      const result = await readProfiles(expectedRevision);
      return contentRevision && contentRevision === result.contentRevision
        ? { ...result, items: [], unchanged: true } : result;
    },
    reset() {
      generation += 1;
      cached = null;
      pending = null;
    },
  };
}

module.exports = { createGiftCardRuntime };
