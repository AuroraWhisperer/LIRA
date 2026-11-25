'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const yauzl = require('yauzl');
const { renameWithRetry } = require('./atomic-file');
const { writeResource } = require('../resources/resource-download');
const { isOwnedDirectory } = require('../shared/file-retention');

async function pruneAudioPreparations(dataDir, root, signal) {
  const cutoff = Date.now() - 86400000;
  async function abandoned(directory) {
    signal.throwIfAborted();
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || stat.mtimeMs > cutoff) return false;
    if (stat.isFile()) return true;
    if (!stat.isDirectory()) return false;
    for (const entry of await fs.readdir(directory)) if (!await abandoned(path.join(directory, entry))) return false;
    return true;
  }
  if (!isOwnedDirectory(dataDir, root)) return;
  for (const name of await fs.readdir(root)) {
    if (!/^\.prepare-[A-Za-z0-9]{6}$/.test(name)) continue;
    const directory = path.join(root, name);
    try {
      if (await abandoned(directory) && isOwnedDirectory(dataDir, directory)) {
        signal.throwIfAborted();
        await fs.rm(directory, { recursive: true, force: true });
      }
    } catch { if (signal.aborted) return; }
  }
}

async function ensureAudioRoot(dataDir) {
  let directory = dataDir;
  for (const name of ['', 'components', 'audio']) {
    directory = path.join(directory, name);
    try { await fs.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('AUDIO_PATH_INVALID');
  }
  return directory;
}

async function verifyAudioDirectory(directory, manifest, signal) {
  signal.throwIfAborted();
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  const files = [];
  async function visit(current, prefix = '') {
    signal.throwIfAborted();
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!await visit(path.join(current, entry.name), `${name}/`)) return false;
      } else {
        const file = expected.get(name);
        if (!file) { if (entry.isFile() && name.endsWith('.pdb')) continue; return false; }
        const filename = path.join(current, entry.name);
        const stat = await fs.lstat(filename);
        if (!entry.isFile() || !stat.isFile() || stat.size !== file.size) return false;
        files.push(file);
        expected.delete(name);
      }
    }
    return true;
  }
  try {
    const root = await fs.realpath(directory);
    const complete = await visit(directory);
    signal.throwIfAborted();
    if (!complete || expected.size) return false;
    async function matches(file) {
      signal.throwIfAborted();
      const filename = path.join(root, file.path);
      if (await fs.realpath(path.join(directory, file.path)) !== filename) return false;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(filename, { signal, highWaterMark: 256 * 1024 })) hash.update(chunk);
      return hash.digest('hex') === file.sha256;
    }
    for (let index = 0; index < files.length; index += 4) {
      const batch = await Promise.allSettled(files.slice(index, index + 4).map(matches));
      signal.throwIfAborted();
      for (const result of batch) {
        if (result.status === 'rejected') throw result.reason;
        if (!result.value) return false;
      }
    }
    return true;
  }
  catch (error) {
    signal.throwIfAborted();
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function extractAudioComponent(filename, manifest, directory, signal) {
  const members = new Map(manifest.files.map(file => [file.path, file]));
  const zip = await yauzl.openPromise(filename, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      const file = members.get(entry.fileName);
      const mode = entry.externalFileAttributes >>> 16 & 0o170000;
      if (!file || entry.isEncrypted() || entry.uncompressedSize !== file.size
        || mode && mode !== 0o100000 || entry.fileName.split('/').some(part => !part || part === '.' || part === '..')
        || /[\\:]/.test(entry.fileName)) throw new Error('AUDIO_ARCHIVE_INVALID');
      const destination = path.join(directory, file.path);
      const parent = path.dirname(destination);
      await fs.mkdir(parent, { recursive: true });
      const verified = await writeResource(file, await zip.openReadStreamPromise(entry), { directory: parent, signal });
      await fs.rename(verified, destination);
      members.delete(file.path);
    }
    if (members.size) throw new Error('AUDIO_ARCHIVE_INCOMPLETE');
  } finally { zip.close(); }
}

async function renameDirectory(source, destination) {
  await renameWithRetry(source, destination, { fileSystem: fs, retryCodes: ['EPERM', 'EACCES', 'EBUSY'] });
}

async function publishAudioDirectory(staging, destination) {
  const replaced = `${destination}.replaced-${randomUUID()}`;
  let previous = false;
  try { await renameDirectory(destination, replaced); previous = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await renameDirectory(staging, destination); }
  catch (error) { if (previous) await renameDirectory(replaced, destination); throw error; }
  if (previous) await fs.rm(replaced, { recursive: true, force: true });
}

module.exports = { ensureAudioRoot, verifyAudioDirectory, extractAudioComponent, publishAudioDirectory, pruneAudioPreparations };
