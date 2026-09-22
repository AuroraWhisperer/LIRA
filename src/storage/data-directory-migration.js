'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BROWSER_ENTRIES = [
  'blob_storage',
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Dictionaries',
  'GPUCache',
  'Local Storage',
  'Network',
  'Session Storage',
  'Shared Dictionary',
  'Partitions',
  'Service Worker',
  'IndexedDB',
  'File System',
  'Local State',
  'Preferences',
  'Secure Preferences',
  'DIPS',
  'DIPS-wal',
  'DIPS-shm',
  'SharedStorage',
  'SharedStorage-wal',
  'SharedStorage-shm',
  'Cookies',
  'Cookies-journal',
  'Network Persistent State',
  'Crashpad',
];
const CACHE_ENTRIES = [
  'music-api-cache',
  'music-lyrics-cache',
  'overtime-gift-images',
  'overtime-gift-catalog-v2.json',
  'overtime-gift-assets-state-v2.json',
];

function migrateBrowserData(options) {
  return migrateGroup(options, 'browser', BROWSER_ENTRIES);
}

function migrateCacheData(options) {
  return migrateGroup(options, 'cache', CACHE_ENTRIES);
}

// Only the startup owner may call this, before opening the affected files.
// A journal makes each same-volume rename recoverable without copying or deleting data.
function migrateGroup({ dataDir, fileSystem = fs }, group, allowedEntries) {
  const root = path.resolve(dataDir);
  const targetDir = path.join(root, group);
  const journalPath = path.join(root, `.${group}-layout-v1.json`);
  fileSystem.mkdirSync(root, { recursive: true });
  assertDirectory(fileSystem, root);
  if (fileSystem.existsSync(targetDir)) assertDirectory(fileSystem, targetDir);

  let journal;
  if (fileSystem.existsSync(journalPath)) {
    const stat = fileSystem.lstatSync(journalPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid migration journal: ${journalPath}`);
    journal = JSON.parse(fileSystem.readFileSync(journalPath, 'utf8'));
    if (
      journal.version !== 1 ||
      !['pending', 'complete'].includes(journal.status) ||
      !Array.isArray(journal.entries) ||
      new Set(journal.entries).size !== journal.entries.length ||
      journal.entries.some((name) => !allowedEntries.includes(name))
    ) {
      throw new Error(`Invalid migration journal: ${journalPath}`);
    }
    if (journal.status === 'complete') return { status: 'already-current', group };
  } else {
    const entries = allowedEntries.filter((name) => fileSystem.existsSync(path.join(root, name)));
    // Detect every conflict before recording or moving anything.
    for (const name of entries) {
      const source = path.join(root, name);
      if (fileSystem.lstatSync(source).isSymbolicLink() || fileSystem.existsSync(path.join(targetDir, name))) {
        throw new Error(`Storage migration conflict; files were preserved: ${source}`);
      }
    }
    journal = { version: 1, status: 'pending', entries };
    if (entries.length) assertRuntimeStopped(fileSystem, root);
    writeJournal(fileSystem, journalPath, journal);
  }

  if (journal.entries.length) assertRuntimeStopped(fileSystem, root);
  // Preflight the entire remaining batch, including recovery after interruption.
  for (const name of journal.entries) {
    const source = path.join(root, name);
    const destination = path.join(targetDir, name);
    const hasSource = fileSystem.existsSync(source);
    const hasDestination = fileSystem.existsSync(destination);
    if (hasSource === hasDestination || fileSystem.lstatSync(hasSource ? source : destination).isSymbolicLink()) {
      throw new Error(`Storage migration conflict or missing entry; files were preserved: ${source}`);
    }
  }
  fileSystem.mkdirSync(targetDir, { recursive: true });
  for (const name of journal.entries) {
    const source = path.join(root, name);
    if (fileSystem.existsSync(source)) fileSystem.renameSync(source, path.join(targetDir, name));
  }
  writeJournal(fileSystem, journalPath, { ...journal, status: 'complete' });
  return {
    status: journal.entries.length ? 'migrated' : 'initialized',
    group,
    entries: journal.entries,
  };
}

function assertDirectory(fileSystem, directory) {
  const stat = fileSystem.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Invalid storage directory: ${directory}`);
}

function assertRuntimeStopped(fileSystem, root) {
  const runtimePath = path.join(root, '.server-runtime.json');
  if (!fileSystem.existsSync(runtimePath)) return;
  const runtime = JSON.parse(fileSystem.readFileSync(runtimePath, 'utf8'));
  if (!Number.isSafeInteger(runtime.pid) || runtime.pid <= 0)
    throw new Error('Invalid runtime information; close LIRA before migrating storage.');
  try {
    process.kill(runtime.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    throw error;
  }
  throw new Error('LIRA is still using this data directory. Close it before migrating storage.');
}

function writeJournal(fileSystem, journalPath, journal) {
  const temporaryPath = `${journalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fileSystem.writeFileSync(temporaryPath, JSON.stringify(journal) + '\n', {
      flag: 'wx',
      flush: true,
    });
    fileSystem.renameSync(temporaryPath, journalPath);
  } finally {
    if (fileSystem.existsSync(temporaryPath)) fileSystem.unlinkSync(temporaryPath);
  }
}

module.exports = { migrateBrowserData, migrateCacheData };
