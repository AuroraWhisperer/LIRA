'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { hasWeSingCacheData, ensureWeSingCacheDirectory } = require('../../src/music/wesing-cache');
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
