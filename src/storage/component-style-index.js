'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function unavailable(code = 'STYLE_LIBRARY_INDEX_UNAVAILABLE') {
  return Object.assign(new Error(code === 'STYLE_LIBRARY_INDEX_VERSION'
    ? '样式库由较新版本创建，请更新客户端后再打开。'
    : '样式库索引无法读取，恢复副本也不可用。请保留素材目录并从备份恢复。'), { code, statusCode: 503 });
}

function validateIndex(index) {
  if (Number.isInteger(index?.version) && index.version > 1) throw unavailable('STYLE_LIBRARY_INDEX_VERSION');
  if (index?.version !== 1 || !Array.isArray(index.packages)
    || index.packages.some(pack => !UUID.test(pack?.id) || !Array.isArray(pack.styles)
      || !pack.styles.length || pack.styles.some(style => !UUID.test(style?.id) || typeof style.type !== 'string'))
    || new Set(index.packages.map(pack => pack.id)).size !== index.packages.length) throw unavailable();
  return index;
}

function atomicWrite(root, filename, text) {
  fs.mkdirSync(root, { recursive: true });
  const temporary = path.join(root, `${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600, flush: true });
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temporary, path.join(root, filename)); break; }
      catch (error) {
        if (attempt >= 4 || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
      }
    }
  } finally { fs.rmSync(temporary, { force: true }); }
}

function createComponentStyleIndex(root) {
  let backupCurrent = false;
  let recovery = null;
  function load(filename) {
    try {
      const text = fs.readFileSync(path.join(root, filename), 'utf8');
      return { index: validateIndex(JSON.parse(text)), text };
    } catch (error) {
      if (error.code === 'STYLE_LIBRARY_INDEX_VERSION') throw error;
      if (error.code === 'ENOENT') return { missing: true };
      if (error instanceof SyntaxError || error.code === 'STYLE_LIBRARY_INDEX_UNAVAILABLE') return { damaged: true };
      throw unavailable();
    }
  }
  function mirror(text) {
    try {
      if (fs.existsSync(path.join(root, 'index.backup.json'))
        && fs.readFileSync(path.join(root, 'index.backup.json'), 'utf8') === text) {
        backupCurrent = true; return;
      }
      atomicWrite(root, 'index.backup.json', text);
      backupCurrent = true;
    } catch { backupCurrent = false; }
  }
  return {
    read() {
      const primary = load('index.json');
      if (primary.index) { mirror(primary.text); return primary.index; }
      const backup = load('index.backup.json');
      if (backup.index) {
        try {
          if (primary.damaged) fs.copyFileSync(path.join(root, 'index.json'), path.join(root, `index.damaged-${randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
          atomicWrite(root, 'index.json', backup.text);
        } catch { throw unavailable(); }
        backupCurrent = true;
        recovery = { source: 'backup', recoveredAt: Date.now() };
        // The primary has committed; a failed notice must not undo recovery.
        try { atomicWrite(root, 'index.recovery.json', JSON.stringify(recovery)); } catch { recovery.noticePersisted = false; }
        return backup.index;
      }
      const installed = fs.existsSync(root) && fs.readdirSync(root).some(name => UUID.test(name));
      if (primary.missing && backup.missing && !installed) return { version: 1, packages: [] };
      throw unavailable();
    },
    write(index) {
      const text = JSON.stringify(validateIndex(index));
      atomicWrite(root, 'index.json', text);
      // A backup failure occurs after commit and must not trigger install rollback.
      mirror(text);
    },
    integrity() {
      this.read();
      if (!recovery) {
        try { recovery = JSON.parse(fs.readFileSync(path.join(root, 'index.recovery.json'), 'utf8')); } catch { recovery = null; }
      }
      return { backupCurrent, recovery };
    },
  };
}

module.exports = { createComponentStyleIndex, validateIndex };
