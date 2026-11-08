'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createFixture } = require('../helpers/wesing-capture-fixture');
const { createWeSingCacheReader, hasWeSingCacheData, ensureWeSingCacheDirectory } = require('../../src/music/wesing-cache');
const { discoverWeSingCachePath, getWeSingCacheCandidates } = require('../../src/music/wesing-cache-discovery');

function cacheFixture(t, name, kind = 'log') {
  const root = createScratchDirectory('wesing-discovery-', t);
  const cachePath = path.join(root, name, 'WeSingCache');
  const directory = kind === 'log' ? path.join(cachePath, 'Log', 'WeSing') : path.join(cachePath, 'WeSingDL', 'Res', 'song-id');
  fs.mkdirSync(directory, { recursive: true });
  if (kind === 'log') fs.writeFileSync(path.join(directory, 'WeSing.log'), 'synthetic log');
  if (kind === 'qrc') fs.writeFileSync(path.join(directory, 'song-id.qrc'), 'synthetic cached QRC');
  return cachePath;
}

test('WeSing validates downloaded cache data without creating empty directories', async (t) => {
  const missing = path.join(createScratchDirectory('wesing-missing-', t), 'WeSingCache');
  const empty = cacheFixture(t, 'empty', 'empty');
  assert.equal(await hasWeSingCacheData(missing), false);
  assert.equal(await hasWeSingCacheData(empty), false);
  await assert.rejects(ensureWeSingCacheDirectory(missing), /播放.*伴奏/);
  assert.equal(fs.existsSync(missing), false);
  for (const kind of ['log', 'qrc']) {
    const existing = cacheFixture(t, kind, kind);
    assert.equal(await hasWeSingCacheData(existing), true);
    assert.equal(await ensureWeSingCacheDirectory(existing), existing);
  }
});

test('WeSing discovers the unique populated candidate and keeps a valid saved choice', async (t) => {
  const empty = cacheFixture(t, 'empty', 'empty');
  const first = cacheFixture(t, 'first');
  const second = cacheFixture(t, 'second', 'qrc');
  assert.equal(await discoverWeSingCachePath({ cachePath: empty, candidates: [empty, first, first] }), first);
  assert.equal(await discoverWeSingCachePath({ cachePath: first, candidates: [second] }), first);
  assert.equal(await discoverWeSingCachePath({ candidates: [first, second] }), '', 'ambiguous directories require manual selection');
  assert.equal(await discoverWeSingCachePath({ candidates: [empty] }), '');
});

test('WeSing cache presence stops after finding QRC data without statting the remaining songs', async (t) => {
  const cachePath = cacheFixture(t, 'qrc', 'qrc');
  const resDir = path.join(cachePath, 'WeSingDL', 'Res');
  for (let index = 0; index < 250; index += 1) {
    const mid = `cached-${index}`;
    fs.mkdirSync(path.join(resDir, mid));
    fs.writeFileSync(path.join(resDir, mid, `${mid}.qrc`), 'cached data');
  }
  const originalStat = fs.promises.stat;
  let qrcStats = 0;
  t.mock.method(fs.promises, 'stat', async function (filePath, ...args) {
    if (path.extname(filePath) === '.qrc') qrcStats += 1;
    return Reflect.apply(originalStat, this, [filePath, ...args]);
  });

  assert.equal(await hasWeSingCacheData(cachePath), true);
  assert.ok(qrcStats < 125, `presence checked ${qrcStats} files in a 251-song cache`);
});

test('WeSing discovery only probes the configured profile locations and drive-root cache names', () => {
  const drivePaths = [...'CDEFGHIJKLMNOPQRSTUVWXYZ'].map((drive) => `${drive}:\\WeSingCache`);
  for (const userDirectory of ['C:\\Users\\Test User', 'E:\\用户资料\\小明']) {
    const environment = {
      APPDATA: path.join(userDirectory, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(userDirectory, 'AppData', 'Local'),
    };
    assert.deepEqual(getWeSingCacheCandidates(environment), [
      path.join(environment.APPDATA, 'Tencent', 'WeSing', 'WeSingCache'),
      path.join(environment.LOCALAPPDATA, 'Tencent', 'WeSing', 'WeSingCache'),
      ...drivePaths,
    ]);
  }
  assert.deepEqual(getWeSingCacheCandidates({}), drivePaths, 'missing profile variables must not create relative candidates');
});

test('WeSing follows the cache with the current song instead of a valid stale directory', async (t) => {
  const first = cacheFixture(t, 'old');
  const second = cacheFixture(t, 'active');
  const writeSong = (directory, mid, title, time) => {
    const log = path.join(directory, 'Log', 'WeSing', 'WeSing.log');
    fs.writeFileSync(log, Buffer.from(`event "StartKSong" payload ${JSON.stringify({ mid, songname: title })}`, 'utf16le'));
    fs.utimesSync(log, time, time);
  };
  writeSong(first, 'old-mid', '春泥', 200);
  writeSong(second, 'alin', '天若有情', 100);
  const options = { cachePath: first, candidates: [first, second], title: '天若有情' };
  assert.equal(await discoverWeSingCachePath(options), second, 'a matching song takes priority over unrelated log activity');
  writeSong(first, 'en', '天若有情', 50);
  assert.equal(await discoverWeSingCachePath(options), second, 'newest song log wins between matching caches');
  writeSong(first, 'en', '天若有情', 300);
  assert.equal(await discoverWeSingCachePath({ ...options, cachePath: second }), first);
});

test('WeSing reuses unchanged log parsing and detects appended, truncated, replaced and rotated songs', async (t) => {
  const cachePath = cacheFixture(t, 'reused');
  const logPath = path.join(cachePath, 'Log', 'WeSing', 'WeSing.log');
  const row = (mid, title = '同名歌曲') => Buffer.from(
    `\r\nevent "StartKSong" payload ${JSON.stringify({ mid, songname: title })}\r\n`, 'utf16le');
  fs.writeFileSync(logPath, row('first'));
  const reader = createWeSingCacheReader();
  const originalOpen = fs.promises.open;
  let reads = 0;
  t.mock.method(fs.promises, 'open', async function (...args) {
    reads += 1;
    return Reflect.apply(originalOpen, this, args);
  });
  assert.equal((await reader.read(cachePath, '同名歌曲')).logEntry.mid, 'first');
  assert.equal((await reader.read(cachePath, '另一首歌')).logEntry, null);
  assert.equal((await reader.read(cachePath, '同名歌曲')).logEntry.mid, 'first');
  assert.equal(reads, 1, 'title filtering and repeated checks reuse the unchanged parsed log');

  fs.appendFileSync(logPath, row('second'));
  assert.equal((await reader.read(cachePath, '同名歌曲')).logEntry.mid, 'second');
  fs.writeFileSync(logPath, row('third'));
  assert.equal((await reader.read(cachePath, '同名歌曲')).logEntry.mid, 'third');

  const old = fs.statSync(logPath);
  const replacement = path.join(path.dirname(logPath), 'replacement.tmp');
  fs.writeFileSync(replacement, row('forth'));
  fs.utimesSync(replacement, old.atime, old.mtime);
  fs.renameSync(replacement, logPath);
  assert.equal((await reader.read(cachePath, '同名歌曲')).logEntry.mid, 'forth', 'same size and mtime do not hide file replacement');

  const rotated = path.join(path.dirname(logPath), 'new.log');
  fs.writeFileSync(rotated, row('newest', '新歌'));
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(rotated, later, later);
  assert.equal((await reader.read(cachePath, '同名歌曲')).logEntry, null);
  assert.equal((await reader.read(cachePath, '新歌')).logEntry.mid, 'newest');
  assert.equal(reads, 5, 'each changed file is parsed once, including a cached title mismatch');
});

test('WeSing reuses parsed QRC files without sharing mutable results and detects file replacement', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const filePath = path.join(fixture.cachePath, 'WeSingDL', 'Res', fixture.mid, `${fixture.mid}.qrc`);
  const reader = createWeSingCacheReader();
  const options = { cachePath: fixture.cachePath, title: '测试歌曲', logEntry: null };
  const originalRead = fs.promises.readFile;
  let reads = 0;
  t.mock.method(fs.promises, 'readFile', async function (file, ...args) {
    if (file === filePath) reads += 1;
    return Reflect.apply(originalRead, this, [file, ...args]);
  });

  const first = await reader.loadLyrics(options);
  first.artists.push('unrelated');
  first.lines[0].words[0].text = 'changed';
  assert.equal(await reader.loadLyrics({ ...options, title: '不存在的歌曲' }), null);
  const again = await reader.loadLyrics(options);
  assert.equal(again.lines[0].words[0].text, '你');
  assert.deepEqual(again.artists, ['测试歌手']);
  assert.equal(reads, 1, 'a title miss and repeated selection reuse the decrypted document');

  const stat = fs.statSync(filePath);
  const replacement = path.join(path.dirname(filePath), 'replacement.tmp');
  fs.copyFileSync(filePath, replacement);
  fs.utimesSync(replacement, stat.atime, stat.mtime);
  fs.renameSync(replacement, filePath);
  assert.equal((await reader.loadLyrics(options)).songMid, fixture.mid);
  assert.equal(reads, 2, 'same size and mtime do not hide a replaced QRC');
  reader.clear();
  await reader.loadLyrics(options);
  assert.equal(reads, 3, 'a new capture lifecycle reloads the QRC');
});

test('WeSing retries failed QRC reads and does not refill a cleared cache from an old read', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const reader = createWeSingCacheReader();
  const options = { cachePath: fixture.cachePath, title: '测试歌曲', logEntry: { mid: fixture.mid } };
  const originalRead = fs.promises.readFile;
  let reads = 0;
  let release;
  let started;
  const readStarted = new Promise((resolve) => { started = resolve; });
  const pendingRead = new Promise((resolve) => { release = resolve; });
  t.mock.method(fs.promises, 'readFile', async function (...args) {
    reads += 1;
    if (reads === 1) throw new Error('download is still being written');
    if (reads === 2) { started(); await pendingRead; }
    return Reflect.apply(originalRead, this, args);
  });

  assert.equal(await reader.loadLyrics(options), null);
  const pending = reader.loadLyrics(options);
  await readStarted;
  reader.clear();
  release();
  await pending;
  assert.equal((await reader.loadLyrics(options)).songMid, fixture.mid);
  assert.equal(reads, 3, 'a failed read is retryable and the prior lifecycle cannot retain parsed data');
});

test('WeSing bounds parsed QRC retention as new songs replace the active cache set', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const resDir = path.join(fixture.cachePath, 'WeSingDL', 'Res');
  const firstFile = path.join(resDir, fixture.mid, `${fixture.mid}.qrc`);
  const reader = createWeSingCacheReader();
  const originalRead = fs.promises.readFile;
  let firstReads = 0;
  t.mock.method(fs.promises, 'readFile', async function (file, ...args) {
    if (file === firstFile) firstReads += 1;
    return Reflect.apply(originalRead, this, [file, ...args]);
  });
  const load = (mid) => reader.loadLyrics({ cachePath: fixture.cachePath, logEntry: { mid } });
  await Promise.all([load(fixture.mid), load(fixture.mid)]);
  assert.equal(firstReads, 1, 'concurrent loads share the pending file read');
  for (let index = 0; index < 80; index += 1) {
    const mid = `another-${index}`;
    const directory = path.join(resDir, mid);
    fs.mkdirSync(directory);
    fs.copyFileSync(firstFile, path.join(directory, `${mid}.qrc`));
    await load(mid);
  }
  await load(fixture.mid);
  assert.equal(firstReads, 2, 'least-recently used parsed files are evicted after 80 retained entries');
});
