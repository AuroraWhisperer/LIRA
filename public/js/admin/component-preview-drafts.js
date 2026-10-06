import { SHARED_SCENE_TYPES } from '../shared/scene-components.js';

const PREFIX = 'lira.preview-draft.v1.';
const COMPONENTS = new Set([...SHARED_SCENE_TYPES, 'canvas']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const storageKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? `${PREFIX}${key}` : null;

function mapBrowserUrls(document, resolveUrl) {
  if (!Array.isArray(document?.items)) return document;
  return { ...document, items: document.items.map(item => item?.type === 'browser' && record(item.appearance?.config)
    ? { ...item, appearance: { ...item.appearance, config: { ...item.appearance.config, url: resolveUrl(item) } } }
    : item) };
}

function retainedConfig(component, config) {
  // Provider URLs may contain credentials; only the authorized controller retains them.
  return component === 'canvas' && config.document
    ? { ...config, document: mapBrowserUrls(config.document, () => '') } : config;
}

function browserItems(config) {
  return Array.isArray(config?.document?.items)
    ? config.document.items.filter(item => item?.type === 'browser' && record(item.appearance?.config)) : [];
}

function browserUrlsChanged(saved, draft) {
  const savedUrls = new Map(browserItems(saved).map(item => [item.id, item.appearance.config.url]));
  return browserItems(draft).some(item => item.appearance.config.url !== (savedUrls.get(item.id) ?? ''));
}

function restoreBrowserUrls(document, current) {
  const urls = new Map();
  for (const config of [current.saved, current.draft]) {
    for (const item of config.document?.items || []) {
      if (item?.type === 'browser' && typeof item.appearance?.config?.url === 'string') {
        urls.set(item.id, item.appearance.config.url);
      }
    }
  }
  return mapBrowserUrls(document, item => urls.get(item.id) ?? '');
}

export function readPreviewDraft(key, storage) {
  if (!storageKey(key)) return null;
  try {
    const snapshot = JSON.parse((storage || window.localStorage).getItem(storageKey(key)));
    if (snapshot?.schemaVersion !== 1 || !record(snapshot.components)) return null;
    if (Object.entries(snapshot.components).some(([id, state]) =>
      !COMPONENTS.has(id) || !record(state) || !record(state.saved) || !record(state.draft))) return null;
    const canvas = snapshot.components.canvas;
    if (canvas && Object.hasOwn(canvas, 'browserUrlsChanged') && typeof canvas.browserUrlsChanged !== 'boolean') return null;
    for (const [component, state] of Object.entries(snapshot.components)) {
      state.saved = retainedConfig(component, state.saved);
      state.draft = retainedConfig(component, state.draft);
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function createPreviewDraftRecovery({ key, connections, storage }) {
  const sceneId = connections.find(({ component }) => component === 'canvas')?.controller.getState().saved.document?.id;
  const cached = readPreviewDraft(key, storage);
  const listeners = new Set();
  const subscriptions = [];
  const pending = new Set();
  const initialized = new Map();
  const retained = { ...cached?.components };
  let restored = false;
  let browserRecovery = cached?.components.canvas?.browserUrlsChanged === true;
  let failure = '';
  let serialized = '';
  let applying = false;
  let disposed = false;

  function getState() {
    const dirty = connections.some(({ controller }) => controller.getState().dirty);
    const message = pending.size
      ? '发现上次未保存进度，但当前配置已有变化。请选择恢复草稿或使用当前配置。'
      : restored && dirty ? '已恢复上次未保存进度，尚未应用到直播。' : '';
    const canvas = connections.find(({ component }) => component === 'canvas')?.controller.getState();
    const missingUrls = cached?.components.canvas && browserItems(canvas?.draft).some(item => !item.appearance.config.url);
    const browserMessage = canvas?.loaded && !pending.has('canvas')
      ? missingUrls ? '部分浏览器源缺少网址，请重新填写。'
        : browserRecovery && (!restored || dirty) ? '上次未保存的浏览器源网址修改需重新填写。' : ''
      : '';
    return { pending: pending.size > 0, message: failure || `${message}${browserMessage}` };
  }
  function notify() { for (const listener of listeners) listener(getState()); }
  function snapshot() {
    for (const { component, controller } of connections) {
      const { saved, draft, generation, loading } = controller.getState();
      if (component === 'canvas' && saved.document?.id !== sceneId) continue;
      if (!initialized.has(component) || initialized.get(component) !== generation || loading || pending.has(component)) continue;
      retained[component] = { saved: retainedConfig(component, saved), draft: retainedConfig(component, draft) };
      if (component === 'canvas') retained[component].browserUrlsChanged = browserUrlsChanged(saved, draft);
    }
    return { schemaVersion: 1, components: retained };
  }
  function persist() {
    if (disposed || applying || !storageKey(key)) return;
    initializeReady();
    const canvas = connections.find(({ component }) => component === 'canvas')?.controller.getState();
    if (canvas && (canvas.saving || browserUrlsChanged(canvas.saved, canvas.draft))) {
      browserRecovery = false;
    }
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
    if (connection.component === 'canvas' && previous.saved.document?.id !== current.saved.document?.id) return {};
    const saved = retainedConfig(connection.component, current.saved);
    return Object.fromEntries(Object.entries(previous.draft).filter(([field, value]) =>
      Object.hasOwn(current.draft, field) && !same(value, previous.saved[field]) && !same(value, saved[field])));
  }
  function applyChanges(connection) {
    const changes = changesFor(connection);
    if (!Object.keys(changes).length) return;
    const current = connection.controller.getState();
    if (connection.component === 'canvas' && changes.document) {
      changes.document = restoreBrowserUrls(changes.document, current);
    }
    restored = true;
    if (!Object.entries(changes).every(([field, value]) => same(value, current.draft[field]))) {
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
      const saved = retainedConfig(connection.component, current.saved);
      const draft = retainedConfig(connection.component, current.draft);
      for (const [field, value] of Object.entries(changesFor(connection))) {
        // The desktop may already retain this draft against a newer saved baseline.
        if (same(draft[field], value)) continue;
        if (!same(saved[field], previous.saved[field])
          || !same(draft[field], previous.saved[field])) pending.add(connection.component);
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
    useCurrent() { pending.clear(); restored = false; browserRecovery = false; persist(); notify(); },
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
