'use strict';

const SCENE_SCHEMA_VERSION = 1;
const MAX_SCENE_BYTES = 256 * 1024;
const SCENE_TYPES = Object.freeze(['danmaku', 'clock', 'queue', 'overtime']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class SceneError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'SceneError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function invalidDocument() {
  return new SceneError('SCENE_INVALID_DOCUMENT', 400, '场景文档格式或数值不符合要求。');
}

function assertRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidDocument();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidDocument();
  if (fields && (Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key)))) {
    throw invalidDocument();
  }
}

function assertJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw invalidDocument();
  if (!Array.isArray(value)) assertRecord(value);
  ancestors.add(value);
  for (const entry of Object.values(value)) assertJson(entry, ancestors);
  ancestors.delete(value);
}

function cloneSceneJson(value) {
  try {
    assertJson(value);
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SCENE_BYTES) throw invalidDocument();
    return JSON.parse(serialized);
  } catch {
    throw invalidDocument();
  }
}

function normalizeSceneId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw invalidDocument();
  return value.toLowerCase();
}

function normalizeName(value) {
  if (typeof value !== 'string' || Array.from(value).length > 80 || !value.trim()) throw invalidDocument();
  return value.trim();
}

function normalizeSceneDocument(input, { normalizeConfig } = {}) {
  const document = cloneSceneJson(input);
  assertRecord(document, ['schemaVersion', 'id', 'title', 'canvas', 'items']);
  if (document.schemaVersion !== SCENE_SCHEMA_VERSION) throw invalidDocument();
  document.id = normalizeSceneId(document.id);
  document.title = normalizeName(document.title);
  assertRecord(document.canvas, ['width', 'height']);
  for (const size of Object.values(document.canvas)) {
    if (!Number.isInteger(size) || size < 320 || size > 7680) throw invalidDocument();
  }
  if (!Array.isArray(document.items) || document.items.length > 32) throw invalidDocument();
  const ids = new Set();
  for (const item of document.items) {
    assertRecord(item, ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'visible', 'locked', 'appearance']);
    item.id = normalizeSceneId(item.id);
    if (ids.has(item.id) || !SCENE_TYPES.includes(item.type)) throw invalidDocument();
    ids.add(item.id);
    item.name = normalizeName(item.name);
    if (typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean') throw invalidDocument();
    if (![item.x, item.y, item.width, item.height].every(Number.isFinite)) throw invalidDocument();
    if (item.x < 0 || item.y < 0 || item.width < 32 || item.height < 32
      || item.x + item.width > document.canvas.width || item.y + item.height > document.canvas.height) {
      throw invalidDocument();
    }
    assertRecord(item.appearance);
    if (item.appearance.mode === 'shared') {
      assertRecord(item.appearance, ['mode']);
    } else if (item.appearance.mode === 'independent') {
      assertRecord(item.appearance, ['mode', 'config']);
      assertRecord(item.appearance.config);
      if (typeof normalizeConfig !== 'function') throw invalidDocument();
      try {
        const config = normalizeConfig(item.type, item.appearance.config);
        assertRecord(config);
        item.appearance.config = cloneSceneJson(config);
      } catch {
        throw invalidDocument();
      }
    } else {
      throw invalidDocument();
    }
  }
  return cloneSceneJson(document);
}

module.exports = {
  SCENE_SCHEMA_VERSION,
  SCENE_TYPES,
  MAX_SCENE_BYTES,
  SceneError,
  normalizeSceneId,
  normalizeSceneDocument,
};
