'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { validateIndex } = require('../storage/component-style-index');
const { normalizeSceneDocument } = require('../scenes/scene-contract');
const { normalizeSceneConfig } = require('./scene-components');
const { SCENE_TYPES } = require('../shared/scene-component-types');
const { invalidBackup } = require('./component-library-archive');

function transferId(...values) {
  const hex = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function remapReferences(value, identities) {
  if (typeof value === 'string') return value.replace(/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/g, id => identities.get(id) || id);
  if (Array.isArray(value)) return value.map(item => remapReferences(item, identities));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [remapReferences(key, identities), remapReferences(entry, identities)]));
  return value;
}

function portableDocuments(entries) {
  const warnings = new Set();
  const documents = entries.map(({ kind, document }) => {
    const result = structuredClone(document);
    result.items = result.items.filter(item => {
      if (item.type === 'browser' && !item.appearance.config.url.startsWith('/component-web/')) {
        warnings.add('外部浏览器源未包含在备份中，恢复后需重新添加。'); return false;
      }
      if (item.type === 'overtime' && item.appearance.config.path) {
        item.appearance.config.path = ''; warnings.add('加班机的电脑本地背景路径已移除，恢复后需重新选择。');
      }
      return true;
    });
    return { kind, document: normalizeSceneDocument(result, { normalizeConfig: normalizeSceneConfig }) };
  });
  return { documents, warnings: [...warnings] };
}

function validateBackupManifest(manifest, files) {
  if (!manifest || Object.keys(manifest).some(key => !['format', 'version', 'packages', 'documents', 'warnings', 'files'].includes(key))
    || manifest.format !== 'lira-component-library-backup' || manifest.version !== 1
    || !Array.isArray(manifest.documents) || manifest.documents.length > 1000
    || !Array.isArray(manifest.warnings) || manifest.warnings.length > 32
    || manifest.warnings.some(value => typeof value !== 'string' || value.length > 300)
    || !Array.isArray(manifest.packages) || manifest.packages.length > 1000
    || !Array.isArray(manifest.files) || manifest.files.length !== files.length) throw invalidBackup();
  const sorted = value => [...value].sort((a, b) => a.name.localeCompare(b.name));
  if (!isDeepStrictEqual(sorted(manifest.files), sorted(files))) throw invalidBackup('备份文件的摘要或清单不匹配。');
  validateIndex({ version: 1, packages: manifest.packages });
  const styleIds = new Set();
  const names = new Set();
  for (const pack of manifest.packages) {
    if (Object.keys(pack).some(key => !['id', 'packageId', 'name', 'version', 'digest', 'createdAt', 'styles', 'bytes', 'removed'].includes(key))
      || typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 80
      || pack.packageId !== undefined && !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(pack.packageId)
      || pack.version !== undefined && !/^\d+\.\d+\.\d+$/.test(pack.version)
      || pack.digest !== undefined && !/^[a-f0-9]{64}$/.test(pack.digest)
      || !Number.isFinite(pack.bytes) || pack.bytes < 0 || !Number.isFinite(pack.createdAt)
      || pack.removed !== undefined && typeof pack.removed !== 'boolean') throw invalidBackup();
    for (const style of pack.styles) {
      if (styleIds.has(style.id) || !SCENE_TYPES.includes(style.type)
        || style.category !== undefined && !SCENE_TYPES.includes(style.category)
        || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 80
        || style.removed !== undefined && typeof style.removed !== 'boolean'
        || Object.keys(style).some(key => !['id', 'type', 'category', 'name', 'config', 'removed'].includes(key))) throw invalidBackup();
      styleIds.add(style.id);
      normalizeSceneConfig(style.type, style.config);
      if (style.type === 'browser' && !style.config.url.startsWith('/component-web/')) throw invalidBackup();
      const installed = style.config.resourceStyle || style.config.mediaStyle || style.config.cssStyle;
      if (style.type !== 'browser' && installed?.id !== style.id) throw invalidBackup();
    }
  }
  for (const entry of manifest.documents) {
    if (!['saved', 'published'].includes(entry?.kind) || Object.keys(entry).length !== 2) throw invalidBackup();
    const key = `${entry.kind}:${entry.document?.id}`;
    if (names.has(key)) throw invalidBackup();
    names.add(key);
    const document = normalizeSceneDocument(entry.document, { normalizeConfig: normalizeSceneConfig });
    if (document.items.some(item => item.type === 'browser' && !item.appearance.config.url.startsWith('/component-web/')
      || item.type === 'overtime' && item.appearance.config.path)) throw invalidBackup();
    for (const item of document.items) {
      const config = item.appearance.config;
      const installed = config?.resourceStyle || config?.mediaStyle || config?.cssStyle;
      if (installed && !styleIds.has(installed.id)) throw invalidBackup('备份缺少场景所引用的样式参数。');
    }
  }
  return manifest;
}

module.exports = { transferId, remapReferences, portableDocuments, validateBackupManifest };
