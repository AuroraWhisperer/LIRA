import { SCENE_TYPES, SCENE_COMPONENTS } from '../shared/scene-components.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor', 'queue', 'superchats', 'gifts',
  'giftrecords', 'events', 'livesessionid', 'streamerid', 'roomid', 'owner', 'ownerscope', 'data',
  'runtime', 'publication', 'publishedversion', 'revision', 'capability', 'hash', 'encryptedpackage',
  'selectedids', 'selection', 'zoom', 'history', 'cursor', 'epoch', 'remainingseconds', 'deadline']);

function invalid() {
  return new Error('场景模板仅允许有效的显示文档，不允许凭据、运行状态或业务数据。');
}

function safeJson(value, ancestors = new Set(), depth = 0) {
  if (depth > 64) throw invalid();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (/(?:[?&#]|%26|%3f|%23)(?:[^=&\s]*(?:token|secret|password|credential)|authorization|cookie)=|\bBearer\s+\S+/i.test(value)) throw invalid();
    return value;
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null) throw invalid();
  ancestors.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') throw invalid();
    const normalized = key.replace(/[-_]/g, '').toLowerCase();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || FORBIDDEN.has(key)
      || FORBIDDEN.has(normalized) || /token|secret|password|credential|authorization|cookie/i.test(key)) throw invalid();
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw invalid();
    result[key] = safeJson(descriptor.value, ancestors, depth + 1);
  }
  if (Array.isArray(value) && Object.keys(result).length !== value.length) throw invalid();
  ancestors.delete(value);
  return result;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw invalid();
}

function name(value) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > 80) throw invalid();
}

export function validateSceneDocument(input) {
  const document = safeJson(input);
  if (new TextEncoder().encode(JSON.stringify(document)).length > 256 * 1024) throw invalid();
  exactKeys(document, ['schemaVersion', 'id', 'title', 'canvas', 'items']);
  if (document.schemaVersion !== 1 || !UUID.test(document.id)) throw invalid();
  name(document.title);
  exactKeys(document.canvas, ['width', 'height']);
  if (!Object.values(document.canvas).every((size) => Number.isInteger(size) && size >= 320 && size <= 7680)) throw invalid();
  if (!Array.isArray(document.items) || document.items.length > 32) throw invalid();
  const ids = new Set();
  for (const item of document.items) {
    exactKeys(item, ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'visible', 'locked', 'appearance']);
    if (!UUID.test(item.id) || ids.has(item.id.toLowerCase()) || !SCENE_TYPES.includes(item.type)) throw invalid();
    ids.add(item.id.toLowerCase());
    name(item.name);
    if (typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean'
      || ![item.x, item.y, item.width, item.height].every(Number.isFinite)
      || item.x < 0 || item.y < 0 || item.width < 32 || item.height < 32
      || item.x + item.width > document.canvas.width || item.y + item.height > document.canvas.height) throw invalid();
    if (item.appearance?.mode === 'shared') {
      if (SCENE_COMPONENTS[item.type].independentOnly) throw invalid();
      exactKeys(item.appearance, ['mode']);
    }
    else if (item.appearance?.mode === 'independent') {
      exactKeys(item.appearance, ['mode', 'config']);
      if (!item.appearance.config || typeof item.appearance.config !== 'object' || Array.isArray(item.appearance.config)) throw invalid();
    } else throw invalid();
  }
  return document;
}

export function exportSceneTemplate(document) {
  return JSON.stringify(validateSceneDocument(document));
}

function collectBindings(document) {
  const bindings = [];
  function add(item, kind, source, path = []) {
    bindings.push({ id: `binding-${bindings.length + 1}`, itemId: item.id, component: item.type,
      kind, source, path, required: true });
  }
  function resources(item, value, path = []) {
    for (const [key, entry] of Object.entries(value)) {
      const nextPath = [...path, key];
      if (entry && typeof entry === 'object') resources(item, entry, nextPath);
      else if (typeof entry === 'string' && entry) {
        if (/fontfamily$/i.test(key)) add(item, 'font', entry, nextPath);
        else if (/(?:path|url|uri|src|image|asset|media)$/i.test(key) && key !== 'giftImage') add(item, 'media', entry, nextPath);
      }
    }
  }
  for (const item of document.items) {
    if (item.appearance.mode === 'shared') add(item, 'source', 'default');
    else resources(item, item.appearance.config);
    if (item.type !== 'clock') add(item, 'source', item.type);
  }
  return bindings;
}

export function importSceneTemplate(input, { createId = () => globalThis.crypto.randomUUID() } = {}) {
  if (typeof input === 'string' && new TextEncoder().encode(input).length > 256 * 1024) throw invalid();
  const document = validateSceneDocument(typeof input === 'string' ? JSON.parse(input) : input);
  const usedIds = new Set([document.id, ...document.items.map((item) => item.id)].map((id) => id.toLowerCase()));
  function freshId() {
    const id = createId();
    if (typeof id !== 'string' || !UUID.test(id) || usedIds.has(id.toLowerCase())) throw invalid();
    usedIds.add(id.toLowerCase());
    return id;
  }
  document.id = freshId();
  for (const item of document.items) item.id = freshId();
  const bindings = collectBindings(document);
  return {
    document: validateSceneDocument(document),
    bindings: safeJson(bindings),
    resolve(resolutions) {
      exactKeys(resolutions, bindings.map((binding) => binding.id));
      const resolved = validateSceneDocument(document);
      for (const binding of bindings) {
        const resolution = resolutions[binding.id];
        exactKeys(resolution, ['confirmed', 'value']);
        if (resolution.confirmed !== true || typeof resolution.value !== 'string') throw new Error('请明确确认每个字体、素材和逻辑来源的绑定。');
        if (binding.kind === 'source') {
          if (resolution.value !== binding.source) throw new Error('逻辑来源必须绑定到当前账户的对应组件。');
          continue;
        }
        let target = resolved.items.find((item) => item.id === binding.itemId).appearance.config;
        for (const key of binding.path.slice(0, -1)) target = target[key];
        target[binding.path.at(-1)] = resolution.value;
      }
      return validateSceneDocument(resolved);
    },
  };
}
