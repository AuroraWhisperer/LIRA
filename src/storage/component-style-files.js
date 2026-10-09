'use strict';

const fs = require('node:fs');
const path = require('node:path');

const activeImports = new Map();
function beginStyleFileUse(directory) { activeImports.set(directory, (activeImports.get(directory) || 0) + 1); }
function endStyleFileUse(directory) {
  const count = activeImports.get(directory) || 0;
  if (count <= 1) activeImports.delete(directory); else activeImports.set(directory, count - 1);
}
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_SOURCE = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const temporaryName = new RegExp(`^(?:\\.pending-|\\.purged-)${UUID_SOURCE}$|^${UUID_SOURCE}\\.tmp$`);
const fileError = () => Object.assign(new Error('素材目录包含链接或异常文件，请先检查目录。'), { statusCode: 503 });

function renameStyleDirectory(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(source, destination); return; }
    catch (error) {
      if (attempt >= 4 || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

function listStyleFiles(directory, relative = '') {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw fileError();
  const files = [];
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const entry = fs.lstatSync(file);
    const filename = relative ? `${relative}/${name}` : name;
    if (entry.isSymbolicLink()) throw fileError();
    if (entry.isDirectory()) files.push(...listStyleFiles(file, filename));
    else if (entry.isFile()) files.push({ name: filename, bytes: entry.size, file });
    else throw fileError();
  }
  return files;
}

function pruneStyleTemporaryFiles(root, now = Date.now()) {
  if (!fs.existsSync(root)) return;
  if (fs.lstatSync(root).isSymbolicLink()) throw fileError();
  for (const name of fs.readdirSync(root)) {
    if (!temporaryName.test(name)) continue;
    const target = path.join(root, name);
    if (activeImports.has(target)) continue;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || now - stat.mtimeMs < PENDING_TTL_MS) continue;
    try {
      if (stat.isDirectory()) listStyleFiles(target);
      else if (!stat.isFile()) continue;
      fs.rmSync(target, { recursive: stat.isDirectory(), force: true });
    } catch { continue; }
  }
}

module.exports = { activeImports, beginStyleFileUse, endStyleFileUse, PENDING_TTL_MS, listStyleFiles, pruneStyleTemporaryFiles, renameStyleDirectory };
