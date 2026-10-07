'use strict';

const GIFT_INTERACTION_KEYS = ['giftAutoThanksEnabled', 'giftStatsQueryEnabled'];

function emptyState() {
  return { values: { giftAutoThanksEnabled: false, giftStatsQueryEnabled: false },
    status: 'unconfirmed', error: null };
}

function assertGiftInteractionResult(result) {
  if (result?.ok === false || !GIFT_INTERACTION_KEYS.every(key => typeof result?.values?.[key] === 'boolean')) {
    throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
  }
}

// The sync owner supplies its existing account fence and serial queue. This
// controller owns only the two interaction flags and their pending UI state.
function createGiftInteractionController({ prepareWork, enqueue, write, isCurrent, refresh }) {
  let state = emptyState();
  let saving = false;
  const listeners = new Set();

  function getState() {
    return { ...state, values: { ...state.values } };
  }

  function publish(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(getState());
  }

  function confirmState(values) {
    publish({ values: Object.fromEntries(GIFT_INTERACTION_KEYS.map(key => [key, values?.[key] === true])),
      status: saving ? 'pending' : 'confirmed', error: null });
  }

  function fail(error) {
    const code = String(error?.code || 'CLOUD_SYNC_FAILED');
    publish({ status: 'unconfirmed', error: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'CLOUD_SYNC_FAILED' });
  }

  async function set(intent) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)
      || Object.keys(intent).length !== 2 || !GIFT_INTERACTION_KEYS.includes(intent.key)
      || typeof intent.enabled !== 'boolean') {
      throw Object.assign(new Error(), { code: 'INVALID_GIFT_INTERACTION' });
    }
    if (saving) throw Object.assign(new Error(), { code: 'GIFT_INTERACTION_PENDING' });
    const work = prepareWork();
    if (!work) {
      fail({ code: 'LICENSE_NOT_AUTHORIZED' });
      return { ok: false, ...getState() };
    }
    saving = true;
    publish({ status: 'pending', error: null });
    return enqueue(async () => {
      try {
        const values = await write(work, intent);
        if (!isCurrent(work)) return { ok: false, ...getState() };
        saving = false;
        confirmState(values);
        const matched = values[intent.key] === intent.enabled;
        return { ...getState(), ok: matched, error: matched ? null : 'CLOUD_SETTINGS_CHANGED' };
      } catch (error) {
        saving = false;
        if (isCurrent(work)) fail(error);
        return { ok: false, ...getState() };
      } finally {
        saving = false;
      }
    });
  }

  return {
    getState, set, confirmState, fail,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async refresh() {
      // The sync owner fences refresh errors against account and lifecycle changes.
      await refresh();
      return getState();
    },
    reset() { publish(emptyState()); },
    stop() { publish({ status: 'unconfirmed' }); },
    dispose() { listeners.clear(); },
  };
}

module.exports = { createGiftInteractionController, assertGiftInteractionResult };
