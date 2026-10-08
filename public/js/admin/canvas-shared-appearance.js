import { createComponentConfigController } from './component-config-controller.js';
import { hasInstalledAppearance, sceneAppearanceKey } from '../shared/scene-shared-appearance.js';

const LOCAL_TYPES = ['opening', 'songlist', 'lyrics', 'interactions', 'blindbox', 'gift-feed', 'guard-thanks'];

export function createCanvasSharedAppearance({ model, request }) {
  const entries = new Map();
  const listeners = new Set();
  const requests = new AbortController();
  let timer;
  let reading = false;
  let writing = 0;
  let revision = 0;
  const notify = () => { for (const listener of listeners) listener(); };
  function entryFor(item) {
    if (!item) return null;
    const config = item.appearance.config;
    if (!request || !config || !(config.resourceStyle || !hasInstalledAppearance(config) && LOCAL_TYPES.includes(item.type))) return null;
    const key = sceneAppearanceKey(item.type, config);
    if (entries.has(key)) return entries.get(key);
    const entry = { type: item.type, config, timer: null, saving: null, readError: '' };
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
    entry.stop = entry.controller.subscribe(notify);
    return entry;
  }
  async function refresh() {
    clearTimeout(timer);
    if (requests.signal.aborted || reading) return;
    if (writing) { timer = setTimeout(refresh, 750); return; }
    reading = true;
    const currentRevision = revision;
    const active = new Map(model.getSnapshot().items.flatMap(item => {
      const entry = entryFor(item);
      return entry ? [[sceneAppearanceKey(entry.type, entry.config), entry]] : [];
    }));
    try {
      if (!active.size) return;
      const data = await request({ action: 'read', items: [...active.values()].map(({ type, config }) => ({ type, config })) }, requests.signal);
      if (requests.signal.aborted || revision !== currentRevision) return;
      for (const [key, entry] of active) if (data[key]) {
        entry.readError = '';
        entry.controller.receive(data[key]);
      }
    } catch (error) {
      if (!requests.signal.aborted) {
        for (const entry of active.values()) entry.readError = error.message;
        notify();
      }
    } finally {
      reading = false;
      if (!requests.signal.aborted) timer = setTimeout(refresh, 750);
    }
  }
  function save(entry) {
    clearTimeout(entry.timer);
    if (entry.saving) return entry.saving;
    entry.saving = (async () => {
      while (entry.controller.getState().dirty) {
        if (!await entry.controller.save()) {
          return false;
        }
      }
      return true;
    })().finally(() => { entry.saving = null; });
    return entry.saving;
  }
  const stopModel = model.subscribeSnapshot(() => {
    for (const item of model.getSnapshot().items) entryFor(item);
    if (!reading) { clearTimeout(timer); timer = setTimeout(refresh, 0); }
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
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      requests.abort(); clearTimeout(timer); stopModel(); listeners.clear();
      for (const entry of entries.values()) { clearTimeout(entry.timer); entry.stop(); }
    },
  };
}
