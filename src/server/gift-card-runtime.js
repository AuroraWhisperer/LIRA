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
      const baseline = cached;
      let result;
      let remoteRevision = baseline?.remoteRevision;
      let acceptedEpoch = baseline?.syncEpoch;
      let incremental = baseline?.incremental;
      let syncEpoch = null;
      try {
        const items = [];
        const cursors = new Set();
        const eventIds = new Set();
        let cursor = null;
        let append = false;
        let afterRevision = baseline?.incremental ? baseline.remoteRevision : undefined;
        const signal = AbortSignal.timeout(30000);
        do {
          let page;
          try {
            page = normalizeGiftCardProfilePage(await fetchPage({ cursor, signal,
              ...(!cursor && baseline?.remoteRevision ? { revision: baseline.remoteRevision } : {}),
              ...(afterRevision ? { afterRevision } : {}) }));
          } catch (error) {
            if (cursor || !afterRevision || error.status !== 400 || error.code !== 'INVALID_GIFT_CARD_CURSOR') throw error;
            assertCurrent();
            afterRevision = undefined;
            page = normalizeGiftCardProfilePage(await fetchPage({ cursor, signal }));
          }
          assertCurrent();
          if (page.day !== day || (syncEpoch && page.syncEpoch !== syncEpoch)) throw stale();
          syncEpoch = page.syncEpoch;
          if (page.unchanged) {
            if (cursor || !baseline?.remoteRevision || page.revision !== baseline.remoteRevision || page.syncEpoch !== baseline.syncEpoch) throw stale();
            incremental = page.incremental === true;
            result = { ...baseline.result, partial: false };
            break;
          }
          if (!cursor) {
            remoteRevision = page.revision;
            incremental = page.incremental === true;
            append = page.append === true;
            if (append) {
              if (!afterRevision) throw new Error('INVALID_GIFT_CARD_PROFILES');
              if (syncEpoch !== baseline.syncEpoch) throw stale();
              for (const item of baseline.result.items) eventIds.add(item.eventId);
            }
          } else if (remoteRevision !== page.revision || append !== (page.append === true)) {
            throw new Error('INVALID_GIFT_CARD_PROFILES');
          }
          for (const item of page.items) {
            if (eventIds.has(item.eventId)) throw new Error('INVALID_GIFT_CARD_PROFILES');
            eventIds.add(item.eventId);
          }
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor)) throw new Error('INVALID_GIFT_CARD_CURSOR');
          cursors.add(cursor);
        } while (cursor);
        acceptedEpoch = syncEpoch;
        if (append && !items.length) result = { ...baseline.result, partial: false };
        result ??= { viewRevision, day, items: append ? [...baseline.result.items, ...items] : items, partial: false };
      } catch (error) {
        assertCurrent();
        if (error.code === 'GIFT_VIEW_STALE' || (baseline?.syncEpoch && syncEpoch && baseline.syncEpoch !== syncEpoch)) {
          cached = null;
          throw error.code === 'GIFT_VIEW_STALE' ? error : stale();
        }
        result = { ...(baseline?.result || { viewRevision, day, items: [] }), partial: true };
        remoteRevision = baseline?.remoteRevision;
        acceptedEpoch = baseline?.syncEpoch;
        incremental = baseline?.incremental;
      }
      const avatars = result.items === baseline?.result.items ? baseline.avatars
        : prepareAvatars(result.items, acceptedEpoch === baseline?.syncEpoch ? baseline?.result.items || [] : []);
      if (avatars.missing.length || avatars.appliedSize < 0) {
        result.items = await resolveAvatars(result.items, avatars, assertCurrent);
      }
      assertCurrent();
      result.contentRevision = result.items === baseline?.result.items ? baseline.result.contentRevision : randomUUID();
      cached = { key, result, remoteRevision, syncEpoch: acceptedEpoch, incremental, avatars };
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
