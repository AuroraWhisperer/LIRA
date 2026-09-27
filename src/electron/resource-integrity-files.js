'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const MANIFEST_NAME = 'client-integrity-manifest.json';
const SCOPE = 'packaged-app-resources';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 10000;
const CHUNK_SIZE = 256 * 1024;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function validatePath(relative) {
  if (
    typeof relative !== 'string' ||
    (relative !== 'app.asar' && !relative.startsWith('app.asar.unpacked/')) ||
    relative.includes(String.fromCharCode(92)) ||
    /[:<>"|?*]/.test(relative) ||
    [...relative].some((char) => char.charCodeAt(0) < 32) ||
    relative
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i.test(part),
      )
  ) {
    throw failure('PATH_INVALID');
  }
}

function validateManifest(manifest, metadata) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw failure('MANIFEST_INVALID');
  if (['appVersion', 'platform', 'arch'].some((key) => typeof manifest[key] !== 'string' || !manifest[key]))
    throw failure('MANIFEST_INVALID');
  if (manifest.schemaVersion !== 1 || manifest.scope !== SCOPE || manifest.algorithm !== 'sha256') {
    throw failure('MANIFEST_UNSUPPORTED');
  }
  if (
    manifest.appVersion !== metadata.appVersion ||
    manifest.platform !== metadata.platform ||
    manifest.arch !== metadata.arch
  ) {
    throw failure('MANIFEST_VERSION_MISMATCH');
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES)
    throw failure('MANIFEST_INVALID');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object') throw failure('MANIFEST_INVALID');
    validatePath(file.path);
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw failure('PATH_INVALID');
    seen.add(key);
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(file.sha256)
    ) {
      throw failure('MANIFEST_INVALID');
    }
  }
  if (!seen.has('app.asar')) throw failure('MANIFEST_INVALID');
  return manifest;
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

// Electron supplies original-fs so app.asar is never interpreted as a virtual directory.
async function safePath(fs, root, relative, signal) {
  signal?.throwIfAborted();
  const rootStat = await fs.promises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw failure('PATH_UNSAFE');
  const realRoot = await fs.promises.realpath(root);
  const parts = relative.split('/');
  let target = root;
  let stat;
  for (let index = 0; index < parts.length; index += 1) {
    signal?.throwIfAborted();
    target = path.join(target, parts[index]);
    stat = await fs.promises.lstat(target);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))
      throw failure('PATH_UNSAFE');
    if (!within(realRoot, await fs.promises.realpath(target))) throw failure('PATH_UNSAFE');
  }
  return { target, stat };
}

function sameFile(a, b) {
  return ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs'].every((key) => a[key] === b[key]);
}

async function readRaw(fs, root, relative, { signal, maxBytes, expectedSize, collect = false } = {}) {
  const before = await safePath(fs, root, relative, signal);
  const handle = await fs.promises.open(before.target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let stream;
  try {
    signal?.throwIfAborted();
    const initial = await handle.stat();
    if (!initial.isFile()) throw failure('PATH_UNSAFE');
    if (!sameFile(before.stat, initial)) throw failure('FILE_CHANGED');
    if (!sameFile(initial, (await safePath(fs, root, relative, signal)).stat)) throw failure('FILE_CHANGED');
    if (maxBytes != null && initial.size > maxBytes) throw failure('MANIFEST_INVALID');
    const hash = crypto.createHash('sha256');
    const chunks = [];
    let bytes = 0;
    const sizeMismatch = expectedSize != null && initial.size !== expectedSize;
    if (!sizeMismatch) {
      stream = handle.createReadStream({ highWaterMark: CHUNK_SIZE, autoClose: false, signal });
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        bytes += chunk.length;
        if (maxBytes != null && bytes > maxBytes) throw failure('MANIFEST_INVALID');
        hash.update(chunk);
        if (collect) chunks.push(chunk);
      }
    }
    const final = await handle.stat();
    let current;
    try {
      current = await safePath(fs, root, relative, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw failure('FILE_CHANGED');
    }
    if (!sameFile(initial, final) || !sameFile(initial, current.stat) || (!sizeMismatch && bytes !== initial.size))
      throw failure('FILE_CHANGED');
    return {
      size: initial.size,
      sha256: sizeMismatch ? null : hash.digest('hex'),
      content: collect ? Buffer.concat(chunks) : null,
    };
  } finally {
    stream?.destroy();
    await handle.close();
  }
}

function fileReason(error) {
  if (['PATH_INVALID', 'PATH_UNSAFE', 'FILE_CHANGED'].includes(error?.code)) return error.code;
  return error?.code === 'ENOENT' ? 'FILE_MISSING' : 'FILE_UNREADABLE';
}

async function readManifest(fs, root, metadata, signal) {
  let raw;
  try {
    raw = await readRaw(fs, root, MANIFEST_NAME, { maxBytes: MAX_MANIFEST_BYTES, collect: true, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.code === 'ENOENT') throw failure('MANIFEST_MISSING');
    if (['PATH_UNSAFE', 'MANIFEST_INVALID'].includes(error.code)) throw error;
    throw failure('MANIFEST_INVALID');
  }
  let manifest;
  try {
    manifest = JSON.parse(raw.content.toString('utf8'));
  } catch (_) {
    throw failure('MANIFEST_INVALID');
  }
  validateManifest(manifest, metadata);
  // Reject unsafe existing targets before scanning any resource content.
  for (const file of manifest.files) {
    try {
      await safePath(fs, root, file.path, signal);
    } catch (error) {
      if (signal?.aborted || error.code === 'PATH_UNSAFE') throw error;
      // Missing or unreadable files are classified individually by inspectFile.
    }
  }
  return manifest;
}

async function inspectFile(fs, root, expected, signal) {
  try {
    validatePath(expected.path);
    const actual = await readRaw(fs, root, expected.path, { signal, expectedSize: expected.size });
    if (actual.size !== expected.size) return 'SIZE_MISMATCH';
    return actual.sha256.toLowerCase() === expected.sha256.toLowerCase() ? null : 'HASH_MISMATCH';
  } catch (error) {
    if (signal?.aborted) throw error;
    return fileReason(error);
  }
}

module.exports = {
  MANIFEST_NAME,
  SCOPE,
  MAX_MANIFEST_BYTES,
  MAX_FILES,
  validatePath,
  validateManifest,
  safePath,
  readRaw,
  readManifest,
  inspectFile,
  failure,
};
