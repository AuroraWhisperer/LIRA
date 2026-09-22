'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { migrateBrowserData, migrateCacheData } = require('../src/storage/data-directory-migration');
const { resolveDataPaths } = require('../src/shared/data-paths');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, value = name) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  return {
    root,
    put,
    read: (name) => fs.readFileSync(path.join(root, name), 'utf8'),
  };
}

test('layout groups rebuildable data without changing the durable data root', (t) => {
  const { root } = fixture(t);
  const paths = resolveDataPaths(root);
  assert.equal(paths.browserDir, path.join(root, 'browser'));
  assert.equal(paths.musicApiCacheDir, path.join(root, 'cache', 'music-api-cache'));
  assert.equal(paths.giftImagesDir, path.join(root, 'cache', 'overtime-gift-images'));
  assert.equal(paths.updatesDir, path.join(path.dirname(root), 'updates'));
});

test('migration preserves browser, cache and durable bytes and is repeatable', (t) => {
  const { root, put, read } = fixture(t);
  const browser = [
    'Network/Cookies',
    'Local State',
    'Partitions/music-qq/Network/Cookies',
    'Local Storage/leveldb/state',
    'Cache/index',
    'Crashpad/report',
  ];
  const cache = [
    'music-api-cache/a.json',
    'music-lyrics-cache/a.lrc',
    'overtime-gift-images/index.json',
    'overtime-gift-images/a.webp',
    'overtime-gift-catalog-v2.json',
    'overtime-gift-assets-state-v2.json',
  ];
  const durable = [
    'song-request-data.db',
    'song-request-data.db-wal',
    'song-request-data.db-shm',
    'license/device-key.enc',
    'music-auth/qq.cookies.enc',
    'opening-music/upload.mp3',
    'unrecognized-user-file',
  ];
  for (const name of [...browser, ...cache, ...durable]) put(name);
  assert.equal(migrateBrowserData({ dataDir: root }).status, 'migrated');
  assert.equal(migrateCacheData({ dataDir: root }).status, 'migrated');
  for (const name of browser) assert.equal(read(`browser/${name}`), name);
  for (const name of cache) assert.equal(read(`cache/${name}`), name);
  for (const name of durable) assert.equal(read(name), name);
  assert.equal(migrateBrowserData({ dataDir: root }).status, 'already-current');
  assert.equal(migrateCacheData({ dataDir: root }).status, 'already-current');
});

test('interrupted migration resumes without overwriting moved state', (t) => {
  const { root, put, read } = fixture(t);
  put('Cache/index', 'cache');
  put('Network/Cookies', 'cookies');
  const brokenFs = Object.create(fs);
  brokenFs.renameSync = (source, destination) => {
    if (source === path.join(root, 'Network')) throw new Error('simulated file lock');
    fs.renameSync(source, destination);
  };
  assert.throws(() => migrateBrowserData({ dataDir: root, fileSystem: brokenFs }), /simulated file lock/);
  assert.equal(read('browser/Cache/index'), 'cache');
  assert.equal(read('Network/Cookies'), 'cookies');
  assert.equal(migrateBrowserData({ dataDir: root }).status, 'migrated');
  assert.equal(read('browser/Network/Cookies'), 'cookies');
});

test('conflicting source and destination abort before any entry moves', (t) => {
  const { root, put, read } = fixture(t);
  put('Cache/index', 'old-cache');
  put('Network/Cookies', 'old-login');
  put('browser/Network/Cookies', 'new-login');
  assert.throws(() => migrateBrowserData({ dataDir: root }), /conflict/);
  assert.equal(read('Cache/index'), 'old-cache');
  assert.equal(read('Network/Cookies'), 'old-login');
  assert.equal(read('browser/Network/Cookies'), 'new-login');
  assert.equal(fs.existsSync(path.join(root, '.browser-layout-v1.json')), false);
});

test('a missing pending entry and a forged journal cannot publish a completed migration', (t) => {
  const { root, put } = fixture(t);
  put('.browser-layout-v1.json', JSON.stringify({ version: 1, status: 'pending', entries: ['Network'] }));
  assert.throws(() => migrateBrowserData({ dataDir: root }), /missing entry/);
  put('.browser-layout-v1.json', JSON.stringify({ version: 1, status: 'pending', entries: ['../outside'] }));
  assert.throws(() => migrateBrowserData({ dataDir: root }), /Invalid migration journal/);
});

test('an active server prevents cache relocation', (t) => {
  const { root, put, read } = fixture(t);
  put('.server-runtime.json', JSON.stringify({ pid: process.pid }));
  put('music-api-cache/a.json', 'cached');
  assert.throws(() => migrateCacheData({ dataDir: root }), /still using this data directory/);
  assert.equal(read('music-api-cache/a.json'), 'cached');
});

test('cleared caches are recreated by their owner without importing stale legacy copies', (t) => {
  const { root, put } = fixture(t);
  migrateCacheData({ dataDir: root });
  fs.rmSync(path.join(root, 'cache'), { recursive: true });
  put('music-api-cache/old.json');
  assert.equal(migrateCacheData({ dataDir: root }).status, 'already-current');
  assert.equal(fs.existsSync(path.join(root, 'cache')), false);
});

test('a redirected cache directory cannot move data outside the selected root', (t) => {
  const { root, put, read } = fixture(t);
  put('untouched/keep.txt', 'preserved');
  put('music-api-cache/a.json', 'cached');
  fs.symlinkSync(path.join(root, 'untouched'), path.join(root, 'cache'), 'junction');
  assert.throws(() => migrateCacheData({ dataDir: root }), /Invalid storage directory/);
  assert.equal(read('untouched/keep.txt'), 'preserved');
  assert.equal(read('music-api-cache/a.json'), 'cached');
});

test('failure to publish completion keeps the journal recoverable after all renames', (t) => {
  const { root, put, read } = fixture(t);
  put('music-api-cache/a.json', 'cached');
  let journalWrites = 0;
  const brokenFs = Object.create(fs);
  brokenFs.writeFileSync = (file, contents, options) => {
    if (++journalWrites === 2) throw new Error('simulated disk failure');
    fs.writeFileSync(file, contents, options);
  };
  assert.throws(() => migrateCacheData({ dataDir: root, fileSystem: brokenFs }), /simulated disk failure/);
  assert.equal(read('cache/music-api-cache/a.json'), 'cached');
  assert.equal(migrateCacheData({ dataDir: root }).status, 'migrated');
});
