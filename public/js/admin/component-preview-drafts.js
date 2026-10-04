import { SHARED_SCENE_TYPES } from '../shared/scene-components.js';

const PREFIX = 'lira.preview-draft.v1.';
const COMPONENTS = new Set([...SHARED_SCENE_TYPES, 'canvas']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const storageKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? `${PREFIX}${key}` : null;

export function readPreviewDraft(key, storage) {
  if (!storageKey(key)) return null;
  try {
    const snapshot = JSON.parse((storage || window.localStorage).getItem(storageKey(key)));
    if (snapshot?.schemaVersion !== 1 || !record(snapshot.components)) return null;
    if (Object.entries(snapshot.components).some(([id, state]) =>
      !COMPONENTS.has(id) || !record(state) || !record(state.saved) || !record(state.draft))) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function createPreviewDraftRecovery({ key, connections, storage }) {
  const cached = readPreviewDraft(key, storage);
  const listeners = new Set();
  const subscriptions = [];
  const pending = new Set();
  const initialized = new Map();
  const retained = { ...cached?.components };
  let restored = false;
  let failure = '';
  let serialized = '';
  let applying = false;
  let disposed = false;

  function getState() {
    const dirty = connections.some(({ controller }) => controller.getState().dirty);
    return { pending: pending.size > 0, message: failure || (pending.size
      ? '发现上次未保存进度，但当前配置已有变化。请选择恢复草稿或使用当前配置。'
      : restored && dirty ? '已恢复上次未保存进度，尚未应用到直播。' : '') };
  }
  function notify() { for (const listener of listeners) listener(getState()); }
  function snapshot() {
    for (const { component, controller } of connections) {
      const { saved, draft, generation, loading } = controller.getState();
      if (!initialized.has(component) || initialized.get(component) !== generation || loading || pending.has(component)) continue;
      retained[component] = { saved, draft };
    }
    return { schemaVersion: 1, components: retained };
  }
  function persist() {
    if (disposed || applying || !storageKey(key)) return;
    initializeReady();
    const next = JSON.stringify(snapshot());
    if (next !== serialized) {
      try {
        (storage || window.localStorage).setItem(storageKey(key), next);
        serialized = next;
        failure = '';
      } catch {
        failure = '无法保留本地恢复草稿，请在关闭页面前保存修改。';
      }
    }
    notify();
  }
  function changesFor(connection) {
    const previous = cached?.components[connection.component];
    if (!previous) return {};
    const current = connection.controller.getState();
    return Object.fromEntries(Object.entries(previous.draft).filter(([field, value]) =>
      Object.hasOwn(current.draft, field) && !same(value, previous.saved[field]) && !same(value, current.saved[field])));
  }
  function applyChanges(connection) {
    const changes = changesFor(connection);
    if (!Object.keys(changes).length) return;
    restored = true;
    if (!Object.entries(changes).every(([field, value]) => same(value, connection.controller.getState().draft[field]))) {
      connection.controller.edit(changes);
    }
  }
  function initializeReady() {
    applying = true;
    for (const connection of connections) {
      const current = connection.controller.getState();
      if (!current.loaded || current.loading || initialized.has(connection.component)) continue;
      initialized.set(connection.component, current.generation);
      const previous = cached?.components[connection.component];
      for (const [field, value] of Object.entries(changesFor(connection))) {
        // The desktop may already retain this draft against a newer saved baseline.
        if (same(current.draft[field], value)) continue;
        if (!same(current.saved[field], previous.saved[field])
          || !same(current.draft[field], previous.saved[field])) pending.add(connection.component);
      }
      if (!pending.has(connection.component)) applyChanges(connection);
    }
    applying = false;
  }
  function restore() {
    applying = true;
    for (const connection of connections) {
      if (!pending.has(connection.component) || !connection.controller.getState().loaded) continue;
      applyChanges(connection);
      pending.delete(connection.component);
    }
    applying = false;
    persist();
    notify();
  }
  persist();
  for (const { controller } of connections) subscriptions.push(controller.subscribe(persist));
  return {
    getState,
    restore,
    useCurrent() { pending.clear(); restored = false; persist(); notify(); },
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    dispose() {
      if (disposed) return;
      persist();
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      listeners.clear();
    },
  };
}
