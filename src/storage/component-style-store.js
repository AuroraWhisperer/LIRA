'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createComponentStyleIndex } = require('./component-style-index');
const { activeImports, beginStyleFileUse, endStyleFileUse, pruneStyleTemporaryFiles, renameStyleDirectory } = require('./component-style-files');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function isSuite(pack, packages) {
  const candidates = pack.packageId ? [pack, ...packages.filter(item => item.packageId === pack.packageId)] : [pack];
  return candidates.some(item => new Set(item.styles.map(style => style.category || style.type)).size > 1);
}

function createComponentStyleStore(dataDir) {
  if (!dataDir) throw new Error('素材目录尚未准备完成。');
  const root = path.join(path.resolve(dataDir), 'component-library');
  pruneStyleTemporaryFiles(root);
  const indexFile = createComponentStyleIndex(root);
  const read = () => indexFile.read();
  const write = index => indexFile.write(index);
  function directory(id, pending = false) {
    if (!UUID.test(id)) throw Object.assign(new Error('素材标识无效。'), { statusCode: 400 });
    return path.join(root, pending ? `.pending-${id}` : id);
  }
  function removePending(id) { fs.rmSync(directory(id, true), { recursive: true, force: true }); }
  return {
    root, directory, read, integrity: () => indexFile.integrity(),
    beginPending(id) { beginStyleFileUse(directory(id, true)); },
    endPending(id) { endStyleFileUse(directory(id, true)); },
    cancelPending(id) {
      if (activeImports.has(directory(id, true))) throw Object.assign(new Error('素材正在处理，请稍后再取消。'), { statusCode: 409 });
      removePending(id); return { id };
    },
    list() {
      const { packages } = read();
      return packages.filter(pack => !pack.removed).map(pack => ({ ...pack, isSuite: isSuite(pack, packages),
        importTarget: isSuite(pack, packages) ? 'suite' : pack.styles[0].category || pack.styles[0].type,
        styles: pack.styles.filter(style => !style.removed) }));
    },
    describe(pack) {
      const { packages } = read();
      const suite = isSuite(pack, packages);
      return { ...pack, isSuite: suite, replaces: pack.packageId ? packages
        .filter(item => !item.removed && item.packageId === pack.packageId && item.version !== pack.version)
        .map(({ id, name, version }) => ({ id, name, version })) : [] };
    },
    stage(pack) {
      const dir = directory(pack.id, true);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pack), { mode: 0o600 });
    },
    pending(id) { return JSON.parse(fs.readFileSync(path.join(directory(id, true), 'package.json'), 'utf8')); },
    removePending,
    install(id) {
      const pack = this.pending(id);
      const index = read();
      const same = pack.packageId && index.packages.find(item => item.packageId === pack.packageId && item.version === pack.version);
      const replaced = pack.packageId ? index.packages.filter(item =>
        !item.removed && item.packageId === pack.packageId && item !== same) : [];
      if (same) {
        if (same.digest !== pack.digest) throw Object.assign(new Error('同名同版本素材包内容不同，请作者更新版本号后再导入。'), { statusCode: 409 });
        const restored = !!same.removed || same.styles.some(style => style.removed);
        delete same.removed;
        for (const style of same.styles) delete style.removed;
        for (const item of replaced) item.removed = true;
        const restoreFiles = !fs.existsSync(directory(same.id));
        if (restoreFiles) {
          fs.writeFileSync(path.join(directory(id, true), 'package.json'), JSON.stringify(same), { mode: 0o600 });
          renameStyleDirectory(directory(id, true), directory(same.id));
        }
        try { write(index); }
        catch (error) { if (restoreFiles) renameStyleDirectory(directory(same.id), directory(id, true)); throw error; }
        removePending(id);
        return { ...same, alreadyInstalled: !restored && !replaced.length, restored, replaced: replaced.length };
      }
      if (index.packages.length >= 1000) throw Object.assign(new Error('样式库已达到上限。'), { statusCode: 400 });
      fs.renameSync(directory(id, true), directory(id));
      try {
        for (const item of replaced) item.removed = true;
        index.packages.push(pack); write(index);
      }
      catch (error) { fs.renameSync(directory(id), directory(id, true)); throw error; }
      return { ...pack, replaced: replaced.length };
    },
    removePack(id) {
      const index = read();
      const pack = index.packages.find(item => item.id === id);
      if (!pack) throw Object.assign(new Error('素材包不存在。'), { statusCode: 404 });
      pack.removed = true;
      write(index);
      return { id };
    },
    restorePackages(packs, commitScenes) {
      const index = read();
      const additions = packs.filter(pack => !index.packages.some(item => item.id === pack.id));
      if (index.packages.length + additions.length > 1000) throw Object.assign(new Error('样式库已达到上限。'), { statusCode: 400 });
      const moved = [];
      try {
        for (const pack of packs) if (!fs.existsSync(directory(pack.id))) {
          renameStyleDirectory(directory(pack.id, true), directory(pack.id)); moved.push(pack.id);
        }
        index.packages.push(...additions.map(pack => ({ ...pack, removed: true })));
        write(index);
      } catch (error) {
        for (const id of moved.reverse()) renameStyleDirectory(directory(id), directory(id, true));
        throw error;
      }
      // If scene persistence fails, hidden packages remain retryable and reclaimable.
      // A later retry reuses stable IDs without replacing any existing scenes/settings.
      const result = commitScenes();
      for (const pack of packs) if (!pack.removed) delete index.packages.find(item => item.id === pack.id).removed;
      write(index);
      return result;
    },
    updateConfig(styleId, update) {
      const index = read();
      const pack = index.packages.find(item => !item.removed && item.styles.some(style => style.id === styleId && !style.removed));
      const style = pack?.styles.find(item => item.id === styleId);
      if (!style) throw Object.assign(new Error('样式已移除，请重新选择。'), { statusCode: 404 });
      style.config = update(style);
      write(index);
      return style;
    },
    remove(styleId) {
      const index = read();
      const pack = index.packages.find(pack => pack.styles.some(style => style.id === styleId));
      const style = pack?.styles.find(style => style.id === styleId);
      if (!style) throw Object.assign(new Error('样式不存在。'), { statusCode: 404 });
      style.removed = true;
      write(index);
      return { id: styleId };
    },
  };
}

module.exports = { createComponentStyleStore };
