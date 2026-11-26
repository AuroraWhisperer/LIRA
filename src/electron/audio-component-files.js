'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const yauzl = require('yauzl');
const { renameWithRetry } = require('./atomic-file');
const { writeResource } = require('../resources/resource-download');
const { isOwnedDirectory } = require('../shared/file-retention');

async function listPlainAudioTree(directory, signal, cutoff = Infinity) {
  const members = [];
  async function visit(filename) {
    signal.throwIfAborted();
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || stat.mtimeMs > cutoff) return false;
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(filename)) {
        if (!await visit(path.join(filename, name))) return false;
      }
    } else if (!stat.isFile()) return false;
    members.push({ filename, isDirectory: stat.isDirectory() });
    return true;
  }
  return await visit(directory) ? members : null;
}

async function pruneAudioPreparations(dataDir, root, entry, signal) {
  const cutoff = Date.now() - 86400000;
  if (!isOwnedDirectory(dataDir, root)) return;
  for (const name of await fs.readdir(root)) {
    const replaced = /^[a-f0-9]{24}\.replaced-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(name);
    if (!replaced && !/^\.prepare-[A-Za-z0-9]{6}$/.test(name)) continue;
    const directory = path.join(root, name);
    try {
      if (await listPlainAudioTree(directory, signal, cutoff) && isOwnedDirectory(dataDir, directory)) {
        signal.throwIfAborted();
        const image = replaced ? await openIdleAudioImage(directory, entry) : null;
        try { await fs.rm(directory, { recursive: true, force: true }); }
        finally { await image?.close(); }
      }
    } catch { if (signal.aborted) return; }
  }
}

// Windows denies non-truncating write access to a running image and prevents
// new launches while we hold the handle. Renaming its parent offers no such protection.
async function openIdleAudioImage(directory, entry) {
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return null;
    const filename = path.join(directory, entry);
    if (!(await fs.lstat(filename)).isFile()) return null;
    return await fs.open(filename, 'r+');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function audioImageBusy(directory, entry) {
  try {
    const image = await openIdleAudioImage(directory, entry);
    await image?.close();
    return false;
  } catch (error) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) return true;
    throw error;
  }
}

async function removeIdleAudioVersion(dataDir, directory, entry, signal) {
  const image = await openIdleAudioImage(directory, entry);
  if (image) {
    try {
      const members = await listPlainAudioTree(directory, signal);
      if (!members) return;
      const executable = path.join(directory, entry);
      for (const { filename, isDirectory } of members) {
        if (filename === directory || path.relative(executable, filename) === '') continue;
        signal.throwIfAborted();
        if (!isOwnedDirectory(dataDir, path.dirname(filename))) return;
        if (isDirectory) await fs.rmdir(filename);
        else await fs.unlink(filename);
      }
      // Remove the entry last so an interrupted cleanup can continue next launch.
      if (!isOwnedDirectory(dataDir, directory)) return;
      await fs.unlink(executable);
    } finally { await image.close(); }
  }
  if (isOwnedDirectory(dataDir, directory)) await fs.rmdir(directory);
}

async function pruneObsoleteAudioVersions(dataDir, root, manifest, activeDirectory, signal) {
  if (!isOwnedDirectory(dataDir, root)) return;
  for (const name of await fs.readdir(root)) {
    signal.throwIfAborted();
    if (name === manifest.id || (name !== 'legacy' && !/^[a-f0-9]{24}$/.test(name))) continue;
    const directory = path.join(root, name);
    if (path.relative(directory, activeDirectory) === '' || !isOwnedDirectory(dataDir, directory)) continue;
    // Busy or inaccessible versions stay eligible on the next client start.
    try { await removeIdleAudioVersion(dataDir, directory, manifest.entry, signal); }
    catch { signal.throwIfAborted(); }
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

async function tryPublishAudioDirectory(staging, destination, entry) {
  // All supported worker launches wait on this preparation before starting.
  if (await audioImageBusy(destination, entry)) return false;
  const replaced = `${destination}.replaced-${randomUUID()}`;
  let previous = false;
  try { await renameDirectory(destination, replaced); previous = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await renameDirectory(staging, destination); }
  catch (error) { if (previous) await renameDirectory(replaced, destination); throw error; }
  // The verified replacement is already live. Later preparation can retry housekeeping.
  if (previous) await fs.rm(replaced, { recursive: true, force: true }).catch(() => {});
  return true;
}

module.exports = { ensureAudioRoot, verifyAudioDirectory, extractAudioComponent, tryPublishAudioDirectory,
  audioImageBusy, pruneObsoleteAudioVersions, pruneAudioPreparations };
