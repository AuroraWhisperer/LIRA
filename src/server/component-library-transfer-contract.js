'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { validateIndex } = require('../storage/component-style-index');
const { normalizeSceneDocument } = require('../scenes/scene-contract');
const { normalizeSceneConfig } = require('./scene-components');
const { SCENE_TYPES } = require('../shared/scene-component-types');
const { invalidBackup, backupFileName } = require('./component-library-archive');

function checkBackupDocumentCount(documents) {
  if (documents.length > 1000) throw invalidBackup('备份最多支持 1000 份保存布局与发布快照，请减少布局后重试。');
}

function transferId(...values) {
  const hex = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Export, preflight and restore use the same owned reference fields. Text, labels
// and authored filenames can legitimately contain a package, style or image UUID.
function mapActiveReferences(type, config, { files, packages, mapId = (_kind, id) => id }) {
  function source(url) {
    if (url.startsWith('/scene-text-images/')) {
      const filename = url.slice('/scene-text-images/'.length);
      files?.add(backupFileName(`images/${filename}`));
      const [id, extension] = filename.split('.');
      return `/scene-text-images/${mapId('image', id)}.${extension}`;
    }
    const match = /^\/component-(media|web)\/([a-f0-9-]{36})\/(.+)$/.exec(url);
    if (!match) return url;
    const [, kind, packId, resource] = match;
    files?.add(backupFileName(`packages/${packId}/${kind === 'web' ? 'web/' : ''}${decodeURIComponent(resource)}`));
    packages?.add(packId);
    return `/component-${kind}/${mapId('package', packId)}/${resource}`;
  }
  const result = { ...config };
  if (type === 'browser') result.url = source(config.url);
  if (type === 'text-box') result.nodes = config.nodes.map(node =>
    node.type === 'image' || node.type === 'gift' ? { ...node, src: source(node.src) } : node);
  for (const key of ['cssStyle', 'mediaStyle']) {
    const style = config[key];
    if (style) result[key] = { ...style, id: mapId('style', style.id), src: source(style.src) };
  }
  if (config.resourceStyle) {
    const style = config.resourceStyle;
    result.resourceStyle = { ...style, id: mapId('style', style.id), preview: source(style.preview),
      resources: Object.fromEntries(Object.entries(style.resources).map(([key, url]) => [key, source(url)])) };
  }
  return result;
}

function mapConfigReferences(type, config, mapId) {
  const result = mapActiveReferences(type, config, { mapId });
  // A switched-out style keeps its settings. Only IDs present in the archive have a mapping.
  if (config.styleParameters) {
    result.styleParameters = Object.fromEntries(Object.entries(config.styleParameters).map(([key, value]) => {
      const match = /^(web|css|media|resource):(.+)$/.exec(key);
      if (!match) return [key, value];
      const [, prefix, id] = match;
      return [`${prefix}:${mapId(prefix === 'web' ? 'package' : 'style', id)}`, value];
    }));
  }
  return result;
}

function backupDependencies(documents) {
  const dependencies = { files: new Set(), packages: new Set() };
  for (const { document } of documents) for (const item of document.items) {
    if (item.appearance.config) mapActiveReferences(item.type, item.appearance.config, dependencies);
  }
  return {
    files: dependencies.files,
    uses: pack => dependencies.packages.has(pack.id),
    include(pack) {
      for (const style of pack.styles) mapActiveReferences(style.type, style.config, dependencies);
    },
  };
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
    || !Array.isArray(manifest.documents)
    || !Array.isArray(manifest.warnings) || manifest.warnings.length > 32
    || manifest.warnings.some(value => typeof value !== 'string' || value.length > 300)
    || !Array.isArray(manifest.packages) || manifest.packages.length > 1000
    || !Array.isArray(manifest.files) || manifest.files.length !== files.length) throw invalidBackup();
  checkBackupDocumentCount(manifest.documents);
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

module.exports = { transferId, mapConfigReferences, backupDependencies, portableDocuments, validateBackupManifest, checkBackupDocumentCount };
