// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

test('personal playlist cache survives a restart for up to twenty-four hours', async () => {
  const values = new Map();
  let now = Date.UTC(2026, 7, 3, 8, 0, 0);
  class TestDate extends Date {
    static now() {
      return now;
    }
  }
  const localStorage = {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
  };
  const { CacheManager } = await loadCacheManager({
    localStorage,
    Date: TestDate,
  });
  const cached = {
    items: [{ id: 'liked-1', title: '缓存歌曲' }],
    itemType: 'track',
    action: 'liked',
  };

  new CacheManager().set('qq:liked', cached);
  now += 12 * 60 * 60 * 1000;

  assert.deepEqual(JSON.parse(JSON.stringify(new CacheManager().get('qq:liked'))), cached);

  now += 13 * 60 * 60 * 1000;
  assert.equal(new CacheManager().get('qq:liked'), null);
});

test('large playlist caches have a bounded memory footprint without truncating playlist data', async () => {
  const { CacheManager } = await loadCacheManager({
    localStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
  });
  const cache = new CacheManager();
  let latest;
  for (let index = 0; index < 100; index += 1) {
    latest = { items: Array.from({ length: 1000 }, (_, song) => ({ id: `${index}-${song}`, title: '歌'.repeat(50) })) };
    cache.set(`qq:playlist-tracks:${index}`, latest);
  }
  const footprint = [...cache._mem.values()].reduce((sum, entry) => sum + JSON.stringify(entry.data).length * 2, 0);
  assert.ok(footprint <= 8 * 1024 * 1024, `retained ${footprint} serialized bytes`);
  assert.ok(cache._mem.size <= 64);
  assert.equal(cache.get('qq:playlist-tracks:99'), latest);
  assert.equal(cache.get('qq:playlist-tracks:99').items.length, 1000);
});

for (const hours of [12, 24, 168]) {
  test(`playlist writes evict expired entries over ${hours} accelerated hours without revisiting old keys`, async () => {
    let now = 1000;
    const { CacheManager } = await loadCacheManager({
      Date: class extends Date { static now() { return now; } },
      localStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
    });
    const cache = new CacheManager();
    for (let hour = 0; hour < hours; hour += 1) {
      cache.set(`qq:playlist-tracks:${hour}`, { items: [{ id: hour }] });
      now += 3600000;
    }
    assert.ok(cache._mem.size <= Math.min(hours, 24), `retained ${cache._mem.size} expired/current playlists`);
  });
}

async function loadCacheManager(globals) {
  const filePath = path.join(__dirname, '..', 'public', 'js', 'playback', 'cache', 'manager.js');
  const context = vm.createContext({ console, ...globals });
  const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
    context,
    identifier: pathToFileURL(filePath).href,
  });
  await module.link(() => {
    throw new Error('CacheManager should not import dependencies.');
  });
  await module.evaluate();
  return module.namespace;
}
