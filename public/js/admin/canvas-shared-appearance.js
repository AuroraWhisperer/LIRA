import { createComponentConfigController } from './component-config-controller.js';
import { hasInstalledAppearance, sceneAppearanceKey } from '../shared/scene-shared-appearance.js';

const LOCAL_TYPES = ['opening', 'songlist', 'now-playing', 'lyrics', 'interactions', 'blindbox', 'gift-feed', 'guard-thanks'];

export function createCanvasSharedAppearance({ model, request }) {
  const entries = new Map();
  const listeners = new Set();
  const itemListeners = new Map();
  const requests = new AbortController();
  let active = new Map();
  let previousItems = [];
  let pendingRefresh = false;
  let pendingNotifications = null;
  let timer;
  let reading = false;
  let writing = 0;
  let revision = 0;
  function notify(key) {
    if (pendingNotifications) { pendingNotifications.add(key); return; }
    for (const listener of itemListeners.get(key) || []) listener();
    for (const listener of listeners) listener();
  }
  function batchNotifications(change) {
    pendingNotifications = new Set();
    try { change(); }
    finally {
      const keys = pendingNotifications;
      pendingNotifications = null;
      for (const key of keys) for (const listener of itemListeners.get(key) || []) listener();
      if (keys.size) for (const listener of listeners) listener();
    }
  }
  function entryFor(item) {
    if (!item) return null;
    const config = item.appearance.config;
    if (!request || !config || !(config.resourceStyle || !hasInstalledAppearance(config) && LOCAL_TYPES.includes(item.type))) return null;
    const key = sceneAppearanceKey(item.type, config);
    if (entries.has(key)) {
      const entry = entries.get(key);
      entry.config = config;
      return entry;
    }
    const entry = { key, type: item.type, config, timer: null, saving: null, readError: '' };
    entry.controller = createComponentConfigController({ initial: {}, read: async () => {
      const values = await request({ action: 'read', items: [{ type: entry.type, config: entry.config }] }, requests.signal);
      return values[key];
    }, persist: async (_draft, patch) => {
      writing += 1;
      revision += 1;
      try { return await request({ action: 'patch', type: entry.type, config: entry.config, patch }, requests.signal); }
      finally { writing -= 1; revision += 1; }
    } });
    entries.set(key, entry);
    entry.stop = entry.controller.subscribeChanges(() => notify(key));
    return entry;
  }
  async function refresh() {
    clearTimeout(timer);
    if (requests.signal.aborted || reading) return;
    if (writing) { timer = setTimeout(refresh, 750); return; }
    reading = true;
    const currentRevision = revision;
    const selected = active;
    try {
      if (!selected.size) return;
      const data = await request({ action: 'read', items: [...selected.values()].map(({ type, config }) => ({ type, config })) }, requests.signal);
      if (requests.signal.aborted || revision !== currentRevision) return;
      batchNotifications(() => {
        for (const [key, entry] of selected) if (data[key]) {
          const recovered = Boolean(entry.readError);
          entry.readError = '';
          if (!entry.controller.receive(data[key]) && recovered) notify(key);
        }
      });
    } catch (error) {
      if (!requests.signal.aborted) {
        batchNotifications(() => {
          for (const [key, entry] of selected) if (entry.readError !== error.message) {
            entry.readError = error.message;
            notify(key);
          }
        });
      }
    } finally {
      reading = false;
      if (!requests.signal.aborted && active.size) timer = setTimeout(refresh, pendingRefresh ? 0 : 750);
      pendingRefresh = false;
    }
  }
  function save(entry) {
    clearTimeout(entry.timer);
    if (entry.saving) return entry.saving;
    entry.saving = (async () => {
      while (entry.controller.getStatus().dirty) {
        if (!await entry.controller.save()) {
          return false;
        }
      }
      return true;
    })().finally(() => { entry.saving = null; });
    return entry.saving;
  }
  const stopModel = model.subscribeSnapshot(() => {
    const items = model.getSnapshot().items;
    if (items.length === previousItems.length && items.every((item, index) =>
      item.type === previousItems[index].type && item.appearance === previousItems[index].appearance)) return;
    previousItems = items;
    const next = new Map(items.flatMap(item => {
      const entry = entryFor(item);
      return entry ? [[entry.key, entry]] : [];
    }));
    const changed = next.size !== active.size || [...next.keys()].some(key => !active.has(key));
    active = next;
    if (!changed) return;
    if (reading) pendingRefresh = true;
    else { clearTimeout(timer); if (active.size) timer = setTimeout(refresh, 0); }
  });
  return {
    getState(item) {
      const entry = entryFor(item);
      if (!entry) return;
      const state = entry.controller.getState();
      return { ...state, error: state.error || entry.readError };
    },
    getStates() { return [...entries.values()].map(entry => {
      const state = entry.controller.getState();
      return { ...state, error: state.error || entry.readError };
    }); },
    getStatuses() { return [...entries.values()].map(entry => {
      const state = entry.controller.getStatus();
      return { ...state, error: state.error || entry.readError };
    }); },
    edit(item, patch) {
      const entry = entryFor(item);
      if (!entry) return;
      entry.controller.edit(patch);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { void save(entry); }, 180);
    },
    async save(item) { const entry = entryFor(item); return entry ? save(entry) : true; },
    reload: refresh,
    discard(item) { const entry = entryFor(item); clearTimeout(entry?.timer); entry?.controller.discard(); },
    discardAll() {
      for (const entry of entries.values()) { clearTimeout(entry.timer); entry.controller.discard(); }
    },
    async flush() {
      for (const entry of entries.values()) {
        if (!await save(entry)) throw new Error(entry.controller.getState().error || '共享参数尚未保存，请重试。');
      }
    },
    subscribe(listener, item) {
      if (!item) { listeners.add(listener); return () => listeners.delete(listener); }
      const entry = entryFor(item);
      if (!entry) return () => {};
      if (!itemListeners.has(entry.key)) itemListeners.set(entry.key, new Set());
      const selected = itemListeners.get(entry.key);
      selected.add(listener);
      return () => { selected.delete(listener); if (!selected.size) itemListeners.delete(entry.key); };
    },
    dispose() {
      requests.abort(); clearTimeout(timer); stopModel(); listeners.clear(); itemListeners.clear();
      for (const entry of entries.values()) { clearTimeout(entry.timer); entry.stop(); }
    },
  };
}
