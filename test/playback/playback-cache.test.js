// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { getMusicHomeContent } = require('../../src/music/music-catalog-service');

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
    localStorage: {
      setItem() {},
      getItem() {
        return null;
      },
      removeItem() {},
    },
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

test('playlist writes evict expired entries over 168 accelerated hours without revisiting old keys', async () => {
  let now = 1000;
  const { CacheManager } = await loadCacheManager({
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    localStorage: {
      setItem() {},
      getItem() {
        return null;
      },
      removeItem() {},
    },
  });
  const cache = new CacheManager();
  for (let hour = 0; hour < 168; hour += 1) {
    cache.set(`qq:playlist-tracks:${hour}`, { items: [{ id: hour }] });
    now += 3600000;
  }
  assert.ok(cache._mem.size <= 24, `retained ${cache._mem.size} expired/current playlists`);
});

function loadCacheManager(globals) {
  return loadModuleExports(path.join(__dirname, '../../public/js/playback/cache/manager.js'), globals);
}

function storageFixture(quota = Infinity) {
  const values = new Map([['playbackOutput:v1', 'saved preference']]);
  return { values, localStorage: {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      const next = new Map(values).set(key, String(value));
      if ([...next].reduce((sum, [k, v]) => sum + (k.length + v.length) * 2, 0) > quota) {
        throw new Error('QuotaExceededError');
      }
      values.set(key, String(value));
    },
  } };
}

test('QQ liked bypasses the uncertified v2 drawer cache even while a failing refresh is pending', async () => {
  const { localStorage, values } = storageFixture();
  const cached = id => JSON.stringify({ timestamp: Date.now(), data: { items: [{ id }], itemType: 'track', action: 'liked' } });
  values.set('playbackCache:v2:qq:liked', cached('custom-playlist-song'));
  values.set('playbackCache:v2:qq:playlist-tracks:7', cached('custom-playlist-song'));
  values.set('playbackCache:v2:netease:liked', cached('netease-song'));
  let reply = Promise.withResolvers();
  const root = path.join(__dirname, '../../public/js/playback');
  const { CacheManager } = await loadCacheManager({ localStorage });
  const [{ HomeService }, { ContentLoader }] = await loadModuleExports(
    ['services/home-service.js', 'content/loader.js'].map(file => path.join(root, file)),
    { fetch: () => reply.promise },
  );
  const state = { selectedSource: 'qq' };
  const cacheManager = new CacheManager();
  const home = new HomeService({ state, contentLoader: new ContentLoader({ state, cacheManager }) });
  const opening = home.loadContent('liked').catch(error => error);
  await new Promise(resolve => setImmediate(resolve));
  const whileLoading = Array.from(home.getHomeState().items, item => item.id);
  reply.resolve(Response.json({ ok: false, error: '缺少系统收藏' }, { status: 501 }));
  const failed = await opening;
  assert.deepEqual(whileLoading, []);
  assert.match(failed.message, /缺少系统收藏/);
  assert.equal(home.getHomeState().items.length, 0);

  reply = Promise.withResolvers();
  reply.resolve(Response.json({ ok: true, data: { tracks: [{ id: 'system-song' }], nextOffset: null } }));
  await home.loadContent('liked');
  const restarted = new CacheManager();
  assert.equal(restarted.get('qq:liked').items[0].id, 'system-song');
  assert.equal(restarted.get('qq:playlist-tracks:7').items[0].id, 'custom-playlist-song');
  assert.equal(restarted.get('netease:liked').items[0].id, 'netease-song');
});

for (const directoryCount of [100, 140]) {
  test(`QQ favorites display and cache all 107 songs when the directory reports ${directoryCount}`, async () => {
    const songs = Array.from({ length: 107 }, (_, i) => ({ id: i + 1, mid: `m${i + 1}`, title: `歌曲 ${i + 1}` }));
    const provider = new QQMusicProvider({
      getAuthState: () => ({ loggedIn: true }), getCookieHeader: () => 'uin=123456; p_skey=test',
    });
    provider.requestJson = async (url, params) => {
      if (url.endsWith('/fcg_user_created_diss')) {
        return { data: { disslist: [{ tid: 9001, dirid: 201, dissname: '我喜欢', song_cnt: directoryCount }] } };
      }
      const start = Number(params.song_begin);
      return { cdlist: [{ songlist: songs.slice(start, start + Number(params.song_num)) }] };
    };
    const { localStorage } = storageFixture();
    const { CacheManager } = await loadCacheManager({ localStorage });
    const root = path.join(__dirname, '../../public/js/playback');
    const [{ HomeService }, { ContentLoader }] = await loadModuleExports(
      ['services/home-service.js', 'content/loader.js'].map(file => path.join(root, file)),
      { fetch: async (_url, options) => Response.json({
        ok: true, data: await getMusicHomeContent({ get: () => provider }, JSON.parse(options.body)),
      }) },
    );
    const state = { selectedSource: 'qq' };
    const home = new HomeService({ state, contentLoader: new ContentLoader({ state, cacheManager: new CacheManager() }) });
    const drawer = await home.loadContent('liked');
    const expectedIds = songs.map(song => song.id);
    assert.deepEqual(Array.from(drawer.items, track => track.sourceSongId), expectedIds);
    assert.deepEqual(Array.from(new CacheManager().get('qq:liked').items, track => track.sourceSongId), expectedIds);
  });
}

test('overwriting a playlist skips reading its old body and persists the replacement', async () => {
  const { localStorage } = storageFixture();
  const { CacheManager } = await loadCacheManager({ localStorage });
  const cache = new CacheManager();
  const key = 'qq:playlist-tracks:changing';
  cache.set(key, { items: ['a', 'b'] });
  const reads = [];
  const getItem = localStorage.getItem;
  localStorage.getItem = (key) => { reads.push(key); return getItem(key); };
  cache.set(key, { items: ['b'] });
  assert.ok(!reads.includes(`playbackCache:v2:${key}`));
  assert.deepEqual(Array.from(new CacheManager().get(key).items), ['b']);
});

test('persistent playlist caches stay bounded and expire across restart without revisiting old keys', async () => {
  const { values, localStorage } = storageFixture();
  let now = 1000;
  const { CacheManager } = await loadCacheManager({ localStorage,
    Date: class extends Date { static now() { return now; } } });
  const cache = new CacheManager();
  for (let index = 0; index < 100; index++) cache.set(`qq:playlist-tracks:${index}`, { title: '歌'.repeat(20000) });
  const entries = [...values].filter(([key]) => key.startsWith('playbackCache:v2:'));
  assert.ok(entries.length <= 64);
  assert.ok(entries.reduce((sum, [key, raw]) => sum + (key.length + raw.length) * 2, 0) <= 2 * 1024 * 1024);
  now += 25 * 3600000;
  new CacheManager();
  assert.deepEqual([...values.keys()], ['playbackOutput:v1']);
  assert.equal(values.get('playbackOutput:v1'), 'saved preference');
});

test('quota recovery reclaims only playlist caches and retries the current write', async () => {
  const { values, localStorage } = storageFixture(1800);
  const { CacheManager } = await loadCacheManager({ localStorage });
  const cache = new CacheManager();
  cache.set('qq:playlist-tracks:old', { title: '歌'.repeat(350) });
  cache.set('qq:playlist-tracks:new', { title: '歌'.repeat(500) });
  assert.ok(values.has('playbackCache:v2:qq:playlist-tracks:new'));
  assert.equal(values.get('playbackOutput:v1'), 'saved preference');
});
