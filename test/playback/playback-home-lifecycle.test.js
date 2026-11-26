'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports, response } = require('../helpers/frontend-modules');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createMusicCatalogService } = require('../../src/music/music-catalog-service');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');
const { musicCacheKey, writeMusicJsonCache } = require('../../src/music/music-cache');
const { createDom, createClock } = require('../helpers/toast-dom');
const { createPlaybackApp, flushAsyncWork, closestTarget } = require('../helpers/playback-app');

const ROOT_DIR = path.join(__dirname, '../..');

test('playlist details expose navigation back to the list and reset it when opening a root', async () => {
  const app = await createPlaybackApp({ current: null, selectedSource: 'qq' }, {
    homeAction: 'created-playlists', authState: { platform: 'qq', loggedIn: true },
    loadHome: async ({ action }) => action === 'playlist-tracks'
      ? { tracks: [{ id: 'navigation-track', title: 'Navigation track', source: 'qq' }] }
      : { playlists: [{ id: 'navigation-playlist', title: 'Navigation playlist' }] },
  });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  const body = app.element('playbackDrawerBody');
  const back = app.element('playbackDrawerBack');
  const openPlaylist = async () => {
    await app.emit('playbackDrawerBody', 'click', {
      target: closestTarget({ playbackPlaylistIndex: '0' }, 'playback-playlist-index'),
    });
    await flushAsyncWork();
  };

  await openPlaylist();
  assert.match(body.innerHTML, /Navigation track/);
  assert.notEqual(back.style.display, 'none', 'the playlist detail must offer a way back to its list');
  await app.emit('playbackDrawerBack', 'click');
  assert.match(body.innerHTML, /Navigation playlist/);
  assert.equal(back.style.display, 'none');

  await openPlaylist();
  await app.emitHomeAction();
  await flushAsyncWork();
  assert.match(body.innerHTML, /Navigation playlist/);
  assert.equal(back.style.display, 'none', 'opening a root does not retain the previous detail history');
});

test('recent local playback remains available without signing in to the selected music platform', async () => {
  const local = { id: 'local:history', source: 'local', title: '本地历史歌曲', artists: [],
    filePath: 'D:\\music-fixture\\history.mp3', objectUrl: 'local-media://media/history' };
  const app = await createPlaybackApp({
    current: null, selectedSource: 'qq', mode: 'sequence', volume: 0.75,
    displayHistory: [local],
  }, { homeAction: 'recent', authState: { platform: 'qq', loggedIn: false } });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();

  assert.match(app.element('playbackDrawerBody').innerHTML, /本地历史歌曲/);
  assert.equal(app.element('toast').prepended.length, 0);

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackAction: 'play', playbackHomeTrackIndex: '0' },
      'playback-home-track-action'),
  });
  await flushAsyncWork();
  assert.equal(app.element('music-player').src, local.objectUrl);
  assert.equal(app.audioPlayCalls(), 1);
  assert.equal(app.resolveStreamRequestCount(), 0);
});

test('restored mixed history retains local files through queueing and bulk playback', async () => {
  const local = { id: 'local:history', source: 'local', title: '本地历史歌曲', artists: [],
    filePath: 'D:\\music-fixture\\history.mp3', fileName: 'history.mp3' };
  const resolvedPaths = [];
  const onlineSources = [];
  const app = await createPlaybackApp({
    current: null, selectedSource: 'qq', mode: 'sequence', volume: 0.75,
    displayHistory: [local, { id: 'qq:123', source: 'qq', title: 'QQ 历史歌曲', artists: [] },
      { id: 'netease:456', source: 'netease', title: '网易云历史歌曲', artists: [] }],
  }, {
    homeAction: 'recent', localState: null,
    async resolveLocalMediaUrls(paths) {
      resolvedPaths.push(...paths);
      return { results: { [local.filePath]: { ok: true, url: 'local-media://media/restored' } } };
    },
    resolveStream(_count, request) {
      onlineSources.push(request.track.source);
      return { url: `https://example.test/${request.track.source}.mp3` };
    },
  });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackAction: 'requested', playbackHomeTrackIndex: '0' },
      'playback-home-track-action'),
  });
  await app.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  assert.equal(app.element('music-player').src, 'local-media://media/restored');
  assert.equal(app.audioPlayCalls(), 1);
  assert.equal(resolvedPaths[0], local.filePath);

  await app.emit('playbackDrawerActions', 'click', { target: { id: 'playbackDrawerPlayAll' } });
  await flushAsyncWork();
  const persisted = app.savedState();
  assert.deepEqual(persisted.normalQueueTracks.map(item => item.source), ['local', 'qq', 'netease']);
  assert.equal(persisted.current.filePath, local.filePath);
  assert.equal(app.audioPlayCalls(), 2);
  assert.equal(app.resolveStreamRequestCount(), 0);

  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  await app.emit('playbackNext', 'click');
  await flushAsyncWork();
  assert.deepEqual(onlineSources, ['qq', 'netease']);
});

test('an unavailable local history file uses file recovery without online resolution', async () => {
  let reselections = 0;
  const app = await createPlaybackApp({
    current: null, selectedSource: 'qq', mode: 'sequence', volume: 0.75,
    displayHistory: [{ id: 'local:unavailable', source: 'local', title: '不可用的本地歌曲', artists: [],
      filePath: 'D:\\music-fixture\\unavailable.mp3' }],
  }, {
    homeAction: 'recent', localState: null,
    resolveLocalMediaUrls: async () => ({ results: {} }),
    async selectLocalFiles() {
      reselections += 1;
      return { canceled: true };
    },
  });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackAction: 'play', playbackHomeTrackIndex: '0' },
      'playback-home-track-action'),
  });
  await flushAsyncWork();
  assert.equal(reselections, 1);
  assert.equal(app.audioPlayCalls(), 0);
  assert.equal(app.resolveStreamRequestCount(), 0);
});

test('a failed local URL can be cancelled and reselected after a move in the same session', async () => {
  const local = { id: 'local:A', source: 'local', title: 'A', filePath: 'fixture/A.wav' };
  let moved = false;
  let picks = 0;
  const app = await createPlaybackApp({ current: local, selectedSource: 'qq', mode: 'sequence', volume: 0.75 }, {
    async resolveLocalMediaUrls([path]) {
      const ok = path === local.filePath ? !moved : path === 'fixture/B.wav';
      return { results: { [path]: { ok, url: ok ? `local-media://media/${path}` : '' } } };
    },
    async selectLocalFiles() {
      if (++picks === 1) return { canceled: true };
      return { ok: true, files: [{ path: 'fixture/B.wav', name: 'B.wav' }] };
    },
  });
  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');
  const audio = app.element('music-player');
  assert.equal(audio.src, 'local-media://media/fixture/A.wav');
  moved = true;
  audio.paused = true;
  await app.emit('music-player', 'error');
  assert.equal(picks, 0);
  await app.emit('playbackPlayPause', 'click');
  assert.equal(audio.paused, true);
  await app.emit('playbackPlayPause', 'click');
  assert.equal(picks, 2);
  assert.equal(audio.src, 'local-media://media/fixture/B.wav');
  assert.equal(app.savedState().current.filePath, 'fixture/B.wav');
});

test('track menus release their outside listener on button, keyboard and drawer closure', async () => {
  const { documentRef: document } = createDom();
  const clock = createClock();
  const body = document.createElement('div');
  const menu = document.createElement('div');
  const button = document.createElement('button');
  const item = document.createElement('button');
  menu.classList.toggle = (name, enabled) => enabled ? menu.classList.add(name) : menu.classList.remove(name);
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

test('reopening a cold liked drawer shares pagination and can retry after a shared page fails', async () => {
  const offsets = [];
  let gate;
  let failPage = true;
  const [{ HomeService }, { ContentLoader }] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/playback/services/home-service.js'),
    path.join(ROOT_DIR, 'public/js/playback/content/loader.js'),
  ], {
    async fetch(_url, options) {
      const { offset } = JSON.parse(options.body);
      offsets.push(offset);
      await gate.promise;
      if (failPage && offset === 100) throw new Error('page unavailable');
      const tracks = Array.from({ length: Math.min(100, 250 - offset) }, (_, i) => ({ id: `${offset + i}` }));
      return response({ ok: true, data: { tracks } });
    },
  });
  const cache = new Map();
  const state = { selectedSource: 'qq' };
  const contentLoader = new ContentLoader({ state, cacheManager: cache, readJsonResponse: r => r.payload });
  const service = new HomeService({ state, contentLoader });
  async function reopen() {
    gate = Promise.withResolvers();
    const closed = service.loadContent('liked');
    service.clearHomeState();
    const reopened = service.loadContent('liked');
    gate.resolve();
    assert.equal((await closed).stale, true);
    return reopened;
  }
  await assert.rejects(reopen(), /page unavailable/);
  assert.equal(cache.size, 0);
  assert.deepEqual(offsets, [0, 100]);

  failPage = false;
  offsets.length = 0;
  assert.equal((await reopen()).items.length, 250);
  assert.equal(cache.get('qq:liked').items[249].id, '249');
  assert.deepEqual(offsets, [0, 100, 200]);
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
  const service = createMusicCatalogService({ apiCacheDir });
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

test('a committed playlist removal keeps its receipt after drawer closure or refresh failure', async () => {
  const dir = path.join(ROOT_DIR, 'public/js/playback');
  const [{ HomeService }, { ContentLoader }] = await loadModuleExports([
    path.join(dir, 'services/home-service.js'), path.join(dir, 'content/loader.js'),
  ], { fetch: async () => {
    reads++;
    if (failRead) throw new Error('playlist offline');
    return response({ ok: true, data: { tracks: [...tracks] } });
  } });
  const tracks = [{ id: 'a' }, { id: 'b' }];
  const notices = [], renders = [], errors = [];
  const cache = new Map([['netease:liked', { items: [] }]]);
  const state = { selectedSource: 'qq' };
  let reads = 0, writes = 0, failRead = false;
  const contentLoader = new ContentLoader({ state, readJsonResponse: r => r.payload, cacheManager: {
    get: key => cache.get(key), set: (key, value) => cache.set(key, value), remove: key => cache.delete(key),
  } });
  const homeService = new HomeService({ state, contentLoader, onError: error => errors.push(error.message) });
  const receipt = Promise.withResolvers();
  const { createPlaylistOperations } = await loadModuleExports(path.join(dir, 'operations/playlist-operations.js'), {
    async fetch(_url, { body }) {
      writes++;
      assert.equal(JSON.parse(body).tracks[0].id, tracks.shift().id);
      await receipt.promise;
      return response({ ok: true });
    },
  }, { moduleFixtures: new Map([[path.join(dir, 'ui/components.js'), { showConfirmDialog: async () => true }]]) });
  const operations = createPlaylistOperations({ playbackState: state, homeService, readJsonResponse: r => r.payload,
    toast: (_message, notice) => notices.push(notice), renderPlaybackHomeResults: action => renders.push(action) });

  await homeService.loadContent('liked');
  const removal = operations.removeTrackFromPlaylist(tracks[0], 'liked');
  await flushAsyncWork();
  homeService.clearHomeState();
  receipt.resolve();
  await removal;
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  assert.equal(notices.at(-1).type, 'success');
  assert.deepEqual([...cache.keys()], ['netease:liked']);
  assert.deepEqual(errors, []);
  assert.deepEqual(renders, []);

  assert.deepEqual(Array.from((await homeService.loadContent('liked')).items, item => item.id), ['b']);
  failRead = true;
  await operations.removeTrackFromPlaylist(tracks[0], 'liked');
  assert.equal(writes, 2);
  assert.equal(notices.at(-1).type, 'success');
  assert.deepEqual(errors, ['playlist offline']);
  assert.deepEqual(renders, ['liked']);
  assert.equal(homeService.getHomeState().items.length, 0);
});

test('playlist removal during navigation refreshes only its own detail after opening', async () => {
  const { HomeService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/services/home-service.js'));
  const state = { selectedSource: 'netease' };
  const read = Promise.withResolvers();
  const requests = [];
  const invalidated = [];
  const service = new HomeService({ state, contentLoader: {
    getPlatformGeneration: () => 0,
    invalidateCachedContent(_platform, action, playlistId) { invalidated.push([action, playlistId]); },
    async loadHomeContent(action, { playlistId, forceRefresh }) {
      if (action === 'created-playlists') {
        return { action, itemType: 'playlist', items: [{ id: 'a', title: '喜欢的翻唱' }, { id: 'b' }] };
      }
      requests.push(playlistId);
      if (playlistId === 'b' && !forceRefresh) await read.promise;
      return { action, itemType: 'track', items: forceRefresh ? [] : [{ id: 'old' }] };
    },
  } });
  await service.loadContent('created-playlists');
  await service.loadPlaylistTracks(0);
  const target = service.getPlaylistRemovalTarget('playlist-tracks');
  const removed = service.getItemByIndex(0);
  service.goBack();
  const opening = service.loadPlaylistTracks(1);
  assert.equal((await service.refreshAfterPlaylistRemoval(target, removed)).stale, true);
  const second = { ...target, playlist: { id: 'b' } };
  assert.equal((await service.refreshAfterPlaylistRemoval({ ...second, platform: 'qq' }, removed)).stale, true);
  const refresh = service.refreshAfterPlaylistRemoval(second, removed);
  read.resolve();
  await opening;
  assert.equal((await refresh).items.length, 0);
  assert.equal(service.getCurrentPlaylist().id, 'b');
  assert.deepEqual(requests, ['a', 'b', 'b']);

  await service.loadContent('liked');
  const readsBeforeReceipt = requests.length;
  invalidated.length = 0;
  const ordinary = await service.refreshAfterPlaylistRemoval(target, removed, { playlistId: 'a', isLikedPlaylist: false });
  assert.equal(ordinary.stale, true);
  assert.deepEqual(invalidated, [['playlist-tracks', 'a']]);
  assert.equal(requests.length, readsBeforeReceipt);
  assert.equal(service.getItemByIndex(0).id, 'old');
});

for (const fromLiked of [true, false]) {
  test(`NetEase removal reconciles a cold read through the other favorite-playlist entry (from liked: ${fromLiked})`, async () => {
    const state = { selectedSource: 'netease' };
    const cache = new Map(), errors = [];
    const reads = [];
    const oldRead = Promise.withResolvers();
    const tracks = [{ id: 'a' }, { id: 'b' }];
    let delayRead = false;
    const [{ HomeService }, { ContentLoader }] = await loadModuleExports([
      path.join(ROOT_DIR, 'public/js/playback/services/home-service.js'), path.join(ROOT_DIR, 'public/js/playback/content/loader.js'),
    ], { async fetch(_url, { body }) {
      const { action } = JSON.parse(body);
      if (action === 'created-playlists') return response({ ok: true, data: { playlists: [{ id: '77', title: '我喜欢的音乐' }] } });
      const snapshot = [...tracks];
      reads.push(action);
      if (delayRead) await oldRead.promise;
      else if (!fromLiked && tracks.length === 1) throw new Error('refresh offline');
      return response({ ok: true, data: { tracks: snapshot } });
    } });
    const contentLoader = new ContentLoader({ state, readJsonResponse: r => r.payload, cacheManager: {
      get: key => cache.get(key), set: (key, value) => cache.set(key, value), remove: key => cache.delete(key),
    } });
    const service = new HomeService({ state, contentLoader, onError: error => errors.push(error.message) });
    const open = async liked => {
      if (liked) return service.loadContent('liked');
      await service.loadContent('created-playlists');
      return service.loadPlaylistTracks(0);
    };
    await open(fromLiked);
    const target = service.getPlaylistRemovalTarget(service.getHomeState().action);
    service.clearHomeState();
    service.clearHistory();
    delayRead = true;
    const opening = open(!fromLiked);
    await flushAsyncWork();
    const refresh = service.refreshAfterPlaylistRemoval(target, tracks.shift(), { playlistId: '77', isLikedPlaylist: true });
    delayRead = false;
    oldRead.resolve();
    assert.equal((await opening).stale, true);
    const result = await refresh;
    assert.deepEqual(Array.from(result.items, item => item.id), ['b']);
    const destination = fromLiked ? 'playlist-tracks' : 'liked';
    assert.deepEqual(reads, [fromLiked ? 'liked' : 'playlist-tracks', destination, destination]);
    assert.equal(cache.has(fromLiked ? 'netease:liked' : 'netease:playlist-tracks:77'), false);
    if (fromLiked) {
      assert.equal(service.getCurrentPlaylist().id, '77');
      assert.deepEqual(Array.from(cache.get('netease:playlist-tracks:77').items, item => item.id), ['b']);
    } else {
      assert.deepEqual(errors, ['refresh offline']);
      assert.equal(cache.has('netease:liked'), false);
    }
  });
}

test('NetEase personalized refresh shows the whole stable recommendation pool before repeating', async () => {
  const playlists = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `歌单${i + 1}` }));
  const provider = new NeteaseMusicProvider();
  provider.requestJson = async (_path, { limit }) => ({ result: playlists.slice(0, Number(limit)) });
  const service = createMusicCatalogService();
  const batches = [];
  const app = await createPlaybackApp({ current: null, selectedSource: 'netease', mode: 'sequence', volume: 0.75 }, {
    homeAction: 'personalized', authState: { platform: 'netease', loggedIn: true },
    async loadHome(request) {
      assert.equal(request.platform, 'netease');
      const data = await service.getMusicHomeContent({ get: () => provider }, request);
      batches.push(data.playlists.map(playlist => playlist.id));
      return data;
    },
  });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  for (let i = 0; i < 3; i++) {
    await app.emit('playbackDrawerRefresh', 'click');
    await flushAsyncWork();
  }
  const ids = playlists.map(playlist => String(playlist.id));
  assert.deepEqual(batches, [ids.slice(0, 12), ids.slice(12, 24), ids.slice(24), ids.slice(0, 12)]);
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
  const service = createMusicCatalogService({ apiCacheDir });
  assert.equal((await read(service)).playlists[0].id, 'playlist-a');
  assert.equal((await read(service)).cached, true);
  assert.equal(calls, 1);
  cookie = 'fixture-credential-B';
  assert.equal((await read(service)).playlists[0].id, 'playlist-b');

  const restarted = createMusicCatalogService({ apiCacheDir });
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
  const service = createMusicCatalogService({ apiCacheDir });
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
      fetch: () => {
        const page = Promise.withResolvers();
        pending.push(page);
        return page.promise;
      },
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
          playlistId: 'previously-opened-playlist',
          requestGeneration: 2,
        })
      : null;
    await loader.loadHomeContent('liked', { requestGeneration: 3 });
    assert.equal(pending.length, forceRefresh ? 2 : 1);
    const fresh = response({ ok: true, data: { tracks: [{ id: 'fresh' }] } });
    pending.at(-1).resolve(fresh);
    if (explicitRefresh) {
      assert.equal((await explicitRefresh).stale, true);
      pending[0].resolve(response({ ok: true, data: { tracks: [{ id: 'old-background' }] } }));
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cache.get('qq:liked').items[0].id, 'fresh');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].requestGeneration, 3);
    await loader.loadHomeContent('liked');
    assert.equal(pending.length, forceRefresh ? 3 : 2, 'a later visit revalidates after the shared task finishes');
    pending.at(-1).reject(new Error('offline'));
    await new Promise(setImmediate);
    assert.equal(cache.get('qq:liked').items[0].id, 'fresh');
    assert.equal(updates.length, 1);
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
    assert.equal(updates[0].items[3].title, 'updated entry');
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
  await loader.loadHomeContent('liked');
  assert.equal(pending.length, 2, 'the old completion must not release the new account request');
  assert.equal(cache.get('qq:liked').items[0].id, 'cached');
  loader.invalidatePlatform('netease');
  pending[1]({ items: [{ id: 'new-account' }], itemType: 'track', action: 'liked' });
  await new Promise(setImmediate);
  assert.equal(cache.get('qq:liked').items[0].id, 'new-account');
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

  pending[0](response({ ok: true, data: { tracks: Array.from({ length: 100 }, (_, i) => ({ id: `${i}` })) } }));
  await new Promise(setImmediate);
  assert.equal(pending.length, 2, 'a superseded refresh must not fetch its next page');
  assert.equal((await staleRequest).stale, true);
  assert.deepEqual(
    Array.from(cache.get('qq:liked').items, (item) => item.id),
    ['new-track'],
  );
});

test('ContentLoader background refresh does not overwrite a newer active page', async () => {
  let resolveBackground;
  const updates = [];
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
    onBackgroundUpdate: (update) => updates.push(update),
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
  const current = await loader.loadHomeContent('created-playlists', { forceRefresh: true });
  resolveBackground(response({ ok: true, data: { tracks: [{ id: 'fresh-liked' }] } }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    current.items.map((item) => item.id),
    ['created-playlist'],
  );
  assert.equal(current.itemType, 'playlist');
  assert.equal(current.action, 'created-playlists');
  assert.equal(cache.get('qq:liked').items[0].id, 'fresh-liked');
  assert.deepEqual(updates, []);
});
