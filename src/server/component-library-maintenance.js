'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createComponentStyleStore } = require('../storage/component-style-store');
const { activeImports, listStyleFiles } = require('../storage/component-style-files');

function collectStyleReferences(value, references = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/g)) references.add(match[0]);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStyleReferences(entry, references);
  }
  return references;
}

function createComponentLibraryMaintenance({ dataDir, visitReferences }) {
  const store = createComponentStyleStore(dataDir);
  function inventory() {
    const { packages } = store.read();
    const integrity = store.integrity();
    const references = new Set();
    if (typeof visitReferences !== 'function') throw Object.assign(new Error('场景引用尚未准备完成，请稍后重试。'), { statusCode: 503 });
    visitReferences(value => collectStyleReferences(value, references));
    const visible = pack => !pack.removed && pack.styles.some(style => !style.removed);
    const used = pack => activeImports.has(store.directory(pack.id)) || references.has(pack.id) || pack.styles.some(style => references.has(style.id));
    const included = new Set();
    // Also retain dependencies of visible or referenced styles.
    for (let changed = true; changed;) {
      changed = false;
      for (const pack of packages) if (!included.has(pack.id) && (visible(pack) || used(pack))) {
        included.add(pack.id); collectStyleReferences(pack.styles, references); changed = true;
      }
    }
    const entries = packages.map(pack => {
      const directory = store.directory(pack.id);
      const exists = fs.existsSync(directory);
      if (!exists && (visible(pack) || used(pack))) throw Object.assign(new Error('有正在使用的素材文件缺失，请先重新导入原安装包。'), { statusCode: 503 });
      const purged = path.join(store.root, `.purged-${pack.id}`);
      const hasPurged = fs.existsSync(purged);
      const bytes = [exists ? directory : null, hasPurged ? purged : null].filter(Boolean)
        .reduce((sum, root) => sum + listStyleFiles(root).reduce((total, file) => total + file.bytes, 0), 0);
      return { id: pack.id, name: pack.name, version: pack.version || '', bytes,
        state: visible(pack) ? 'installed' : used(pack) ? 'referenced' : exists || hasPurged ? 'reclaimable' : 'reclaimed' };
    });
    let pendingBytes = 0; let unregisteredBytes = 0;
    for (const name of fs.existsSync(store.root) ? fs.readdirSync(store.root) : []) {
      if (!/^(?:\.pending-|\.purged-)?[a-f0-9-]{36}$/.test(name) || packages.some(pack => pack.id === name || `.purged-${pack.id}` === name)) continue;
      const bytes = listStyleFiles(path.join(store.root, name)).reduce((sum, file) => sum + file.bytes, 0);
      if (name.startsWith('.')) pendingBytes += bytes; else unregisteredBytes += bytes;
    }
    return { entries, pendingBytes, unregisteredBytes, integrity,
      totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, pendingBytes + unregisteredBytes),
      reclaimableBytes: entries.filter(entry => entry.state === 'reclaimable').reduce((sum, entry) => sum + entry.bytes, 0) };
  }
  return {
    inventory,
    cleanup(ids, authorize) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) {
        throw Object.assign(new Error('请选择需要清理的素材包。'), { statusCode: 400 });
      }
      const current = inventory();
      if (!current.integrity.backupCurrent) throw Object.assign(new Error('恢复副本尚未保存成功，请稍后再清理。'), { statusCode: 503 });
      const selected = ids.map(id => current.entries.find(entry => entry.id === id));
      if (selected.some(entry => !entry || !['reclaimable', 'reclaimed'].includes(entry.state))) {
        throw Object.assign(new Error('素材使用情况已变化，请重新查看后再清理。'), { statusCode: 409 });
      }
      authorize();
      let freedBytes = 0;
      const failed = [];
      for (const entry of selected) {
        if (entry.state === 'reclaimed') continue;
        const destination = path.join(store.root, `.purged-${entry.id}`);
        try {
          if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
          if (fs.existsSync(store.directory(entry.id))) fs.renameSync(store.directory(entry.id), destination);
          fs.rmSync(destination, { recursive: true, force: true });
          freedBytes += entry.bytes;
        } catch { failed.push(entry.id); }
      }
      return { freedBytes, failed };
    },
  };
}

module.exports = { createComponentLibraryMaintenance, collectStyleReferences };
