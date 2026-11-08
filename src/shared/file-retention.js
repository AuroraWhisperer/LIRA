'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Callers own file names, live references and policy. Never traverse a linked data directory.
function isOwnedDirectory(root, directory) {
  const base = path.resolve(root);
  const relative = path.relative(base, path.resolve(directory));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    let current = base;
    for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    }
    return true;
  } catch { return false; }
}

function pruneManagedFiles(root, directory, { matches, keep = new Set(), maxAgeMs,
  maxBytes = Infinity, minAgeMs = maxAgeMs, now = Date.now(), refreshKept = false }) {
  const result = { files: 0, bytes: 0 };
  if (!isOwnedDirectory(root, directory)) return result;
  let files;
  try {
    files = fs.readdirSync(directory).filter(matches).map(name => {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      return { name, filename, stat };
    }).filter(({ stat }) => stat.isFile() && !stat.isSymbolicLink());
  } catch { return result; }
  let bytes = files.reduce((total, file) => total + file.stat.size, 0);
  for (const { name, filename, stat } of files.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) {
    try {
      if (keep.has(name)) {
        if (refreshKept && now - stat.mtimeMs > 24 * 60 * 60 * 1000) fs.utimesSync(filename, stat.atime, new Date(now));
        continue;
      }
      const age = now - stat.mtimeMs;
      if (age < minAgeMs || age < maxAgeMs && bytes <= maxBytes) continue;
      if (!isOwnedDirectory(root, directory)) break;
      const current = fs.lstatSync(filename);
      if (!current.isFile() || current.isSymbolicLink() || current.ino !== stat.ino
        || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || keep.has(name)) continue;
      fs.unlinkSync(filename);
      bytes -= stat.size;
      result.files += 1;
      result.bytes += stat.size;
    } catch { continue; }
  }
  return result;
}

module.exports = { isOwnedDirectory, pruneManagedFiles };
