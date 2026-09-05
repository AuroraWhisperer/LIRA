'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports, response } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('cached readers share refresh work without invalidating its cache write', async () => {
  for (const forceRefresh of [false, true]) {
    const pending = [];
    const cache = new Map([['qq:liked', { items: [{ id: 'cached' }], itemType: 'track', action: 'liked' }]]);
    const updates = [];
    const { ContentLoader } = await loadModuleExports(
      path.join(ROOT_DIR, 'public/js/playback/content/loader.js'),
      { fetch: () => new Promise((resolve) => pending.push(resolve)) },
    );
    const loader = new ContentLoader({
      state: { selectedSource: 'qq' },
      cacheManager: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
      readJsonResponse: async (result) => result.payload,
      onBackgroundUpdate: (update) => updates.push(update),
    });
    await loader.loadHomeContent('liked', { requestGeneration: 1 });
    const explicitRefresh = forceRefresh
      ? loader.loadHomeContent('liked', { forceRefresh: true, requestGeneration: 2 })
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

test('HomeService keeps the newest home request and ignores stale success or failure', async () => {
  const pending = new Map();
  const errors = [];
  const { HomeService } = await loadModuleExports(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'services',
      'home-service.js',
    ),
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
  assert.deepEqual(currentResult.items.map((item) => item.id), ['new-item']);
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
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'services',
      'home-service.js',
    ),
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
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'content',
      'loader.js',
    ),
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
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'content',
      'loader.js',
    ),
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
  const cache = new Map([
    [
      'qq:liked',
      { items: [{ id: 'cached-liked' }], itemType: 'track', action: 'liked' },
    ],
  ]);
  const { ContentLoader } = await loadModuleExports(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'content',
      'loader.js',
    ),
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
  resolveBackground(
    response({ ok: true, data: { tracks: [{ id: 'fresh-liked' }] } }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const current = loader.getCurrentHomeContent();
  assert.deepEqual(current.items.map((item) => item.id), ['created-playlist']);
  assert.equal(current.itemType, 'playlist');
  assert.equal(current.action, 'created-playlists');
  assert.equal(current.page, 1);
});
