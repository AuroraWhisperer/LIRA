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
    get length() { return values.size; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return Array.from(values.keys())[index] ?? null; }
  };
  const { CacheManager } = await loadCacheManager({ localStorage, Date: TestDate });
  const cached = { items: [{ id: 'liked-1', title: '缓存歌曲' }], itemType: 'track', action: 'liked' };

  new CacheManager().set('qq:liked', cached);
  now += 12 * 60 * 60 * 1000;

  assert.deepEqual(
    JSON.parse(JSON.stringify(new CacheManager().get('qq:liked'))),
    cached
  );

  now += 13 * 60 * 60 * 1000;
  assert.equal(new CacheManager().get('qq:liked'), null);
});

async function loadCacheManager(globals) {
  const filePath = path.join(__dirname, '..', 'public', 'js', 'playback', 'cache', 'manager.js');
  const context = vm.createContext({ console, ...globals });
  const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
    context,
    identifier: pathToFileURL(filePath).href
  });
  await module.link(() => {
    throw new Error('CacheManager should not import dependencies.');
  });
  await module.evaluate();
  return module.namespace;
}
