'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function createComponentStyleStore(dataDir) {
  if (!dataDir) throw new Error('素材目录尚未准备完成。');
  const root = path.join(path.resolve(dataDir), 'component-library');
  const indexPath = path.join(root, 'index.json');
  function read() {
    try { return JSON.parse(fs.readFileSync(indexPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, packages: [] }; throw error; }
  }
  function write(index) {
    fs.mkdirSync(root, { recursive: true });
    const temporary = path.join(root, `${randomUUID()}.tmp`);
    try { fs.writeFileSync(temporary, JSON.stringify(index), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, indexPath); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
  function directory(id, pending = false) {
    if (!UUID.test(id)) throw Object.assign(new Error('素材标识无效。'), { statusCode: 400 });
    return path.join(root, pending ? `.pending-${id}` : id);
  }
  function removePending(id) { fs.rmSync(directory(id, true), { recursive: true, force: true }); }
  return {
    root, directory, read,
    list() { return read().packages.filter(pack => !pack.removed).map(pack => ({ ...pack, styles: pack.styles.filter(style => !style.removed) })); },
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
      const same = pack.packageId && index.packages.find(item => !item.removed && item.packageId === pack.packageId && item.version === pack.version);
      if (same) {
        if (same.digest !== pack.digest) throw Object.assign(new Error('同名同版本套装内容不同，请作者更新版本号后再导入。'), { statusCode: 409 });
        const restored = same.styles.some(style => style.removed);
        for (const style of same.styles) delete style.removed;
        write(index);
        removePending(id);
        return { ...same, alreadyInstalled: !restored, restored };
      }
      if (index.packages.length >= 1000) throw Object.assign(new Error('样式库已达到上限。'), { statusCode: 400 });
      fs.renameSync(directory(id, true), directory(id));
      try { index.packages.push(pack); write(index); }
      catch (error) { fs.renameSync(directory(id), directory(id, true)); throw error; }
      return pack;
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
