'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports, response } = require('../helpers/frontend-modules');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createLyricsService } = require('../../src/music/lyrics-service');
const { musicCacheKey, writeMusicJsonCache } = require('../../src/music/music-cache');
const { createDom, createClock } = require('../helpers/toast-dom');

const ROOT_DIR = path.join(__dirname, '../..');

test('track menus release their outside listener on button, keyboard and drawer closure', async () => {
  const { documentRef: document } = createDom();
  const clock = createClock();
  const body = document.createElement('div');
  const menu = document.createElement('div');
  const button = document.createElement('button');
  const item = document.createElement('button');
  menu.id = 'track-menu';
  menu.hasAttribute = name => menu.attributes.has(name);
  menu.setAttribute('hidden', '');
  Object.defineProperty(menu, 'hidden', {
    get: () => menu.attributes.has('hidden'),
    set: value => value ? menu.setAttribute('hidden', '') : menu.removeAttribute('hidden'),
  });
  menu.querySelector = () => item;
  menu.querySelectorAll = () => [item];
  item.closest = selector => selector === '.track-menu' ? menu : null;
  document.getElementById = id => id === 'playbackDrawerBody' ? body : null;
  document.querySelectorAll = selector => selector === '.track-menu' ? [menu] : [];
  document.querySelector = selector => selector.includes('track-menu-for') ? menu
    : selector.includes('track-menu-index') || selector.startsWith('[aria-controls=') ? button : null;
  const listeners = new Set();
  document.addEventListener = (type, listener) => { if (type === 'click') listeners.add(listener); };
  document.removeEventListener = (type, listener) => { if (type === 'click') listeners.delete(listener); };
  const globals = { document, window: {}, ...clock };
  const { createHomeHandler } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/features/home-handler.js'), globals);
  const { createEventHandlers } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/core/event-handlers.js'), globals);
  const owner = createHomeHandler({ playbackState: {}, homeService: { clearHomeState() {}, clearHistory() {} },
    uiRenderer: { getDrawer: () => ({ close() {} }) } });
  createEventHandlers({ playbackState: {}, getPlaybackAudio: () => null,
    toggleTrackMenu: owner.toggleTrackMenu, closeTrackMenu: owner.closeTrackMenu }).setupEventHandlers();
  const baseline = listeners.size;
  for (const close of ['button', 'Escape', 'Tab', 'drawer', 'outside']) {
    for (let cycle = 0; cycle < 10; cycle++) {
      owner.toggleTrackMenu(0);
      clock.tick(0);
      assert.equal(menu.hidden, false);
      if (close === 'button') owner.toggleTrackMenu(0);
      else if (close === 'drawer') owner.closePlaybackDrawer();
      else if (close === 'outside') {
        for (const listener of [...listeners]) listener({ target: { closest: () => null } });
      } else body.fire('keydown', { target: item, key: close, preventDefault() {} });
      assert.equal(menu.hidden, true);
      assert.equal(listeners.size, baseline, `listeners after ${close}`);
    }
  }
  owner.toggleTrackMenu(0);
  owner.closePlaybackDrawer();
  clock.tick(0);
  assert.equal(listeners.size, baseline, 'closing before listener installation cancels it');
});

test('account invalidation stops liked pagination after the outstanding page', async () => {
  let resolvePage;
  let requests = 0;
  const { ContentLoader } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/content/loader.js'), {
    fetch() { requests++; return new Promise(resolve => { resolvePage = resolve; }); },
  });
  const cache = new Map();
  const loader = new ContentLoader({ state: { selectedSource: 'qq' }, cacheManager: cache,
    readJsonResponse: async result => result.payload });
  const pending = loader.loadHomeContent('liked');
  loader.invalidatePlatform('qq');
  resolvePage(response({ ok: true, data: { tracks: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })) } }));
  assert.equal((await pending).stale, true);
  assert.equal(requests, 1);
  assert.equal(cache.size, 0);
});

test('playlist refresh bypasses old backend entries and caches an empty result after removal', async (t) => {
  const apiCacheDir = createScratchDirectory('playlist-refresh-', t);
  const service = createLyricsService({ apiCacheDir });
  const track = { source: 'qq', sourceTrackId: 'song', title: 'Synthetic song' };
  let tracks = [track];
  const provider = {
    async getPlaylistTracks() { return tracks.map((item) => ({ ...item })); },
    async removeTracksFromPlaylist() { tracks = []; return { ok: true }; },
  };
  const registry = { get: () => provider };
  const request = { platform: 'qq', action: 'playlist-tracks', limit: 5000, playlistId: 'synthetic' };
  writeMusicJsonCache(apiCacheDir, musicCacheKey('home', request), {
    source: 'qq', action: request.action, playlistId: request.playlistId, tracks,
  });
  const cache = new Map();
  const { ContentLoader } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/content/loader.js'), {
    fetch: async (_url, options) => response({
      ok: true, data: await service.getMusicHomeContent(registry, JSON.parse(options.body)),
    }),
  });
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    cacheManager: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    readJsonResponse: async (result) => result.payload,
  });
  assert.equal((await loader.loadHomeContent(request.action, { playlistId: request.playlistId })).items.length, 1);
  await service.writeMusicPlaylistTracks(registry, {
    platform: 'qq', playlist: { id: request.playlistId }, tracks: [track],
  }, 'remove');

  const refreshed = await loader.loadHomeContent(request.action, {
    playlistId: request.playlistId, forceRefresh: true,
  });
  assert.equal(refreshed.items.length, 0);
  const nextRead = await loader.loadHomeContent(request.action, { playlistId: request.playlistId });
  assert.equal(nextRead.fromCache, true);
  assert.equal(nextRead.items.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.get('qq:playlist-tracks:synthetic').items.length, 0);
  assert.equal((await service.getMusicHomeContent(registry, request)).tracks.length, 0);
});

test('personalized backend cache follows authorization across account changes and service restarts', async (t) => {
  const apiCacheDir = createScratchDirectory('personalized-account-cache-', t);
  let cookie = 'fixture-credential-A';
  let calls = 0;
  const provider = {
    async getSafeCookieHeader() { return cookie; },
    async getPersonalizedPlaylists() {
      calls++;
      return [{ id: cookie === 'fixture-credential-A' ? 'playlist-a' : cookie ? 'playlist-b' : 'anonymous' }];
    },
  };
  const request = { platform: 'qq', action: 'personalized' };
  const read = (service) => service.getMusicHomeContent({ get: () => provider }, request);
  const service = createLyricsService({ apiCacheDir });
  assert.equal((await read(service)).playlists[0].id, 'playlist-a');
  assert.equal((await read(service)).cached, true);
  assert.equal(calls, 1);
  cookie = 'fixture-credential-B';
  assert.equal((await read(service)).playlists[0].id, 'playlist-b');

  const restarted = createLyricsService({ apiCacheDir });
  assert.equal((await read(restarted)).cached, true);
  assert.equal(calls, 2);
  cookie = '';
  assert.equal((await read(restarted)).playlists[0].id, 'anonymous');
  cookie = 'fixture-credential-A';
  assert.equal((await read(restarted)).playlists[0].id, 'playlist-a');
  assert.equal(calls, 3);
  const disk = fs.readdirSync(apiCacheDir).map(name => name + fs.readFileSync(path.join(apiCacheDir, name), 'utf8')).join('');
  assert.doesNotMatch(disk, /fixture-credential-/);
});

test('an account change during personalized retrieval cannot populate either account cache', async (t) => {
  const apiCacheDir = createScratchDirectory('personalized-pending-cache-', t);
  const service = createLyricsService({ apiCacheDir });
  const started = Promise.withResolvers();
  const pending = Promise.withResolvers();
  let cookie = 'old-credential';
  let calls = 0;
  const provider = {
    async getSafeCookieHeader() { return cookie; },
    async getPersonalizedPlaylists() {
      if (++calls === 1) {
        started.resolve();
        return pending.promise;
      }
      return [{ id: cookie === 'old-credential' ? 'old-fresh' : 'new-fresh' }];
    },
  };
  const read = () => service.getMusicHomeContent({ get: () => provider }, { platform: 'qq', action: 'personalized' });
  const oldRequest = read();
  await started.promise;
  cookie = 'new-credential';
  pending.resolve([{ id: 'in-flight-result' }]);
  await oldRequest;
  assert.equal((await read()).playlists[0].id, 'new-fresh');
  cookie = 'old-credential';
  assert.equal((await read()).playlists[0].id, 'old-fresh');
  assert.equal(calls, 3);
});

test('cached readers share refresh work without invalidating its cache write', async () => {
  for (const forceRefresh of [false, true]) {
    const pending = [];
    const cache = new Map([['qq:liked', { items: [{ id: 'cached' }], itemType: 'track', action: 'liked' }]]);
    const updates = [];
    const { ContentLoader } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/content/loader.js'), {
      fetch: () => new Promise((resolve) => pending.push(resolve)),
    });
    const loader = new ContentLoader({
      state: { selectedSource: 'qq' },
      cacheManager: {
        get: (key) => cache.get(key),
        set: (key, value) => cache.set(key, value),
      },
      readJsonResponse: async (result) => result.payload,
      onBackgroundUpdate: (update) => updates.push(update),
    });
    await loader.loadHomeContent('liked', { requestGeneration: 1 });
    const explicitRefresh = forceRefresh
      ? loader.loadHomeContent('liked', {
          forceRefresh: true,
          requestGeneration: 2,
        })
      : null;
    await loader.loadHomeContent('liked', { requestGeneration: 3 });
    assert.equal(pending.length, forceRefresh ? 2 : 1);
    const fresh = response({ ok: true, data: { tracks: [{ id: 'fresh' }] } });
    pending.at(-1)(fresh);
    if (explicitRefresh) {
      assert.equal((await explicitRefresh).stale, true);
      pending[0](response({ ok: true, data: { tracks: [{ id: 'old-background' }] } }));
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cache.get('qq:liked').items[0].id, 'fresh');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].requestGeneration, 3);
    assert.equal(loader._cacheRequestGenerations.size, 0);
  }
});

test('background refresh publishes interior track changes and playlist metadata changes', async () => {
  const { ContentLoader } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/content/loader.js'));
  for (const action of ['liked', 'created-playlists']) {
    const previous = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: `entry ${index}` }));
    const current = previous.map((item, index) => (index === 3 ? { ...item, title: 'updated entry' } : item));
    const updates = [];
    const cache = new Map([['qq:' + action, { items: previous, itemType: 'track', action }]]);
    const loader = new ContentLoader({
      state: { selectedSource: 'qq' },
      cacheManager: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
      onBackgroundUpdate: (update) => updates.push(update),
    });
    loader._fetchByAction = async () => ({ items: current, itemType: 'track', action });
    await loader.loadHomeContent(action);
    await new Promise(setImmediate);
    assert.equal(updates.length, 1);
    assert.equal(loader.homeItems[3].title, 'updated entry');
  }
});

test('account invalidation preserves other providers and a replacement refresh keeps its ownership', async () => {
  const { ContentLoader } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/content/loader.js'));
  const pending = [];
  const state = { selectedSource: 'qq' };
  const cache = new Map([['qq:liked', { items: [{ id: 'cached' }], itemType: 'track', action: 'liked' }]]);
  const loader = new ContentLoader({
    state,
    cacheManager: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
  });
  loader._fetchByAction = () => new Promise((resolve) => pending.push(resolve));
  await loader.loadHomeContent('liked');
  loader.invalidatePlatform('qq');
  await loader.loadHomeContent('liked');
  assert.equal(pending.length, 2);
  pending[0]({ items: [{ id: 'old-account' }], itemType: 'track', action: 'liked' });
  await new Promise(setImmediate);
  assert.equal(loader._bgRefreshing.size, 1);
  assert.equal(cache.get('qq:liked').items[0].id, 'cached');
  loader.invalidatePlatform('netease');
  pending[1]({ items: [{ id: 'new-account' }], itemType: 'track', action: 'liked' });
  await new Promise(setImmediate);
  assert.equal(cache.get('qq:liked').items[0].id, 'new-account');
  assert.equal(loader._bgRefreshing.size, 0);
});

test('HomeService keeps the newest home request and ignores stale success or failure', async () => {
  const pending = new Map();
  const errors = [];
  const { HomeService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'home-service.js'),
  );
  const service = new HomeService({
    state: { selectedSource: 'qq' },
    contentLoader: {
      loadHomeContent(action) {
        return new Promise((resolve, reject) => {
          pending.set(action, { resolve, reject });
        });
      },
    },
    onError(error) {
      errors.push(error);
    },
  });

  const staleRequest = service.loadContent('old');
  const currentRequest = service.loadContent('new');
  pending.get('new').resolve({
    items: [{ id: 'new-item' }],
    itemType: 'track',
    action: 'new',
  });

  const currentResult = await currentRequest;
  assert.deepEqual(
    currentResult.items.map((item) => item.id),
    ['new-item'],
  );
  assert.equal(currentResult.itemType, 'track');
  assert.equal(currentResult.action, 'new');
  assert.equal(currentResult.page, 1);

  pending.get('old').reject(new Error('stale failure'));
  assert.equal((await staleRequest).stale, true);
  assert.equal(service.getHomeState().action, 'new');
  assert.deepEqual(errors, []);
});

test('HomeService invalidates pending content when recent history or clear is selected', async () => {
  const pending = {};
  const { HomeService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'home-service.js'),
  );
  const service = new HomeService({
    state: { selectedSource: 'qq', displayHistory: [{ id: 'recent-item' }] },
    contentLoader: {
      loadHomeContent() {
        return new Promise((resolve) => {
          pending.resolve = resolve;
        });
      },
    },
  });

  const staleRequest = service.loadContent('daily');
  const recent = service.loadLocalRecentHistory();
  pending.resolve({
    items: [{ id: 'daily-item' }],
    itemType: 'track',
    action: 'daily',
  });

  assert.equal(recent.action, 'recent');
  assert.equal((await staleRequest).stale, true);
  assert.equal(service.getHomeState().action, 'recent');

  service.clearHomeState();
  assert.equal(service.getHomeState().action, '');
});

test('ContentLoader keeps a fixed provider cache key when the provider changes during a request', async () => {
  let resolveRequest;
  const cache = new Map();
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      fetch(_url, options) {
        assert.equal(JSON.parse(options.body).platform, 'qq');
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
    },
  );
  const state = { selectedSource: 'qq' };
  const loader = new ContentLoader({
    state,
    cacheManager: {
      get(key) {
        return cache.get(key) || null;
      },
      set(key, value) {
        cache.set(key, value);
      },
    },
    readJsonResponse: async (result) => result.payload,
  });

  const request = loader.loadHomeContent('liked', { forceRefresh: true });
  state.selectedSource = 'netease';
  resolveRequest(response({ ok: true, data: { tracks: [{ id: 'qq-track' }] } }));

  assert.equal((await request).stale, true);
  assert.equal(cache.has('qq:liked'), true);
  assert.equal(cache.has('netease:liked'), false);
});

test('ContentLoader keeps the newest result when same-key requests finish out of order', async () => {
  const pending = [];
  const cache = new Map();
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      fetch() {
        return new Promise((resolve) => pending.push(resolve));
      },
    },
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    cacheManager: {
      get(key) {
        return cache.get(key) || null;
      },
      set(key, value) {
        cache.set(key, value);
      },
    },
    readJsonResponse: async (result) => result.payload,
  });

  const staleRequest = loader.loadHomeContent('liked', { forceRefresh: true });
  const currentRequest = loader.loadHomeContent('liked', {
    forceRefresh: true,
  });
  pending[1](response({ ok: true, data: { tracks: [{ id: 'new-track' }] } }));
  assert.deepEqual(
    Array.from((await currentRequest).items, (item) => item.id),
    ['new-track'],
  );

  pending[0](response({ ok: true, data: { tracks: [{ id: 'old-track' }] } }));
  assert.equal((await staleRequest).stale, true);
  assert.deepEqual(
    Array.from(cache.get('qq:liked').items, (item) => item.id),
    ['new-track'],
  );
});

test('ContentLoader background refresh does not overwrite a newer active page', async () => {
  let resolveBackground;
  const cache = new Map([['qq:liked', { items: [{ id: 'cached-liked' }], itemType: 'track', action: 'liked' }]]);
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      fetch(_url, options) {
        const body = JSON.parse(options.body);
        if (body.action === 'liked') {
          return new Promise((resolve) => {
            resolveBackground = resolve;
          });
        }
        return Promise.resolve(
          response({
            ok: true,
            data: { playlists: [{ id: 'created-playlist' }] },
          }),
        );
      },
    },
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    cacheManager: {
      get(key) {
        return cache.get(key) || null;
      },
      set(key, value) {
        cache.set(key, value);
      },
    },
    readJsonResponse: async (result) => result.payload,
  });

  await loader.loadHomeContent('liked');
  await loader.loadHomeContent('created-playlists', { forceRefresh: true });
  resolveBackground(response({ ok: true, data: { tracks: [{ id: 'fresh-liked' }] } }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const current = loader.getCurrentHomeContent();
  assert.deepEqual(
    current.items.map((item) => item.id),
    ['created-playlist'],
  );
  assert.equal(current.itemType, 'playlist');
  assert.equal(current.action, 'created-playlists');
  assert.equal(current.page, 1);
});
