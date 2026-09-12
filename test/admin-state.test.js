'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js');

class FakeWebSocket {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  emit(type, payload) {
    for (const handler of this.listeners.get(type) || []) handler(payload);
  }
}

function createGlobals(fetch) {
  const events = [];
  return {
    fetch,
    location: { protocol: 'http:', host: 'localhost' },
    window: {
      dispatchEvent(event) {
        events.push(event);
      },
    },
    document: {
      getElementById() {
        return { hidden: false, textContent: '', className: '' };
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    WebSocket: FakeWebSocket,
    events,
  };
}

async function createSongReloadHarness() {
  const requests = [];
  const globals = createGlobals((url) => {
    const request = Promise.withResolvers();
    requests.push({ url, ...request });
    return request.promise;
  });
  const filters = { songSearch: 'older' };
  globals.URLSearchParams = URLSearchParams;
  globals.document.getElementById = (id) => ({ value: filters[id] || '' });
  globals.document.querySelectorAll = () => [];
  const { StateService } = await loadModuleExports(STATE_PATH, globals);
  const service = new StateService();
  const updates = [];
  globals.window.AdminApp.eventBus.on('song:updated', ({ songs }) => updates.push(songs));
  let stateReloads = 0;
  service.reloadState = async () => {
    stateReloads += 1;
  };
  return {
    service,
    filters,
    requests,
    updates,
    get stateReloads() {
      return stateReloads;
    },
  };
}

function resolveSongs(request, songs) {
  request.resolve({ json: async () => ({ ok: true, data: songs }) });
}

for (const reloadState of [true, false]) {
  for (const olderFirst of [true, false]) {
    test(`Admin accepts only the latest song filter request (reloadState=${reloadState}, olderFirst=${olderFirst})`, async () => {
      const harness = await createSongReloadHarness();
      const { service, filters, requests, updates } = harness;
      const initialSongs = [{ id: 0 }];
      const newerSongs = [{ id: 2 }];
      service.songs = initialSongs;
      const options = reloadState ? undefined : { reloadState: false };
      const olderReload = service.reloadSongs(options);
      filters.songSearch = 'newer';
      const newerReload = service.reloadSongs(options);
      assert.deepEqual(requests.map(({ url }) => url), [
        '/api/songs?query=older',
        '/api/songs?query=newer',
      ]);

      if (olderFirst) {
        resolveSongs(requests[0], [{ id: 1 }]);
        await olderReload;
        assert.equal(service.getSongs(), initialSongs);
        assert.deepEqual(updates, []);
        assert.equal(harness.stateReloads, 0);
      }
      resolveSongs(requests[1], newerSongs);
      await newerReload;
      assert.equal(service.getSongs(), newerSongs);
      assert.deepEqual(updates, [newerSongs]);

      if (!olderFirst) {
        resolveSongs(requests[0], [{ id: 1 }]);
        await olderReload;
      }
      assert.equal(service.getSongs(), newerSongs);
      assert.deepEqual(updates, [newerSongs]);
      assert.equal(harness.stateReloads, reloadState ? 1 : 0);
    });
  }
}

test('Admin ignores an older song response whose JSON finishes after a newer reload', async () => {
  const { service, filters, requests, updates } = await createSongReloadHarness();
  const body = Promise.withResolvers();
  const parsing = Promise.withResolvers();
  const olderReload = service.reloadSongs({ reloadState: false });
  requests[0].resolve({
    json() {
      parsing.resolve();
      return body.promise;
    },
  });
  await parsing.promise;
  filters.songSearch = 'newer';
  const newerReload = service.reloadSongs({ reloadState: false });
  const newerSongs = [{ id: 2 }];
  resolveSongs(requests[1], newerSongs);
  await newerReload;
  body.resolve({ ok: true, data: [{ id: 1 }] });
  await olderReload;

  assert.equal(service.getSongs(), newerSongs);
  assert.deepEqual(updates, [newerSongs]);
});

test('Admin does not emit an obsolete song update after waiting for application state', async () => {
  const { service, filters, requests, updates } = await createSongReloadHarness();
  const stateStarted = Promise.withResolvers();
  const stateFinished = Promise.withResolvers();
  service.reloadState = () => {
    stateStarted.resolve();
    return stateFinished.promise;
  };
  const olderReload = service.reloadSongs();
  resolveSongs(requests[0], [{ id: 1 }]);
  await stateStarted.promise;

  filters.songSearch = 'newer';
  const newerReload = service.reloadSongs({ reloadState: false });
  const newerSongs = [{ id: 2 }];
  resolveSongs(requests[1], newerSongs);
  await newerReload;
  stateFinished.resolve();
  await olderReload;

  assert.equal(service.getSongs(), newerSongs);
  assert.deepEqual(updates, [newerSongs]);
});

test('Admin reports the latest song request failure without accepting an older result', async () => {
  const harness = await createSongReloadHarness();
  const { service, filters, requests, updates } = harness;
  const initialSongs = service.getSongs();
  const olderReload = service.reloadSongs();
  filters.songSearch = 'newer';
  const newerReload = service.reloadSongs();
  requests[1].resolve({ json: async () => ({ ok: false, error: '最新筛选失败' }) });
  await assert.rejects(newerReload, /最新筛选失败/);
  resolveSongs(requests[0], [{ id: 1 }]);
  await olderReload;

  assert.equal(service.getSongs(), initialSongs);
  assert.deepEqual(updates, []);
  assert.equal(harness.stateReloads, 0);
});

test('Admin reloads songs for cloud invalidation and preserves snapshot filtering', async () => {
  const globals = createGlobals(async () => ({
    json: async () => ({ ok: true, data: { categories: [], tags: [] } }),
  }));
  const { StateService } = await loadModuleExports(STATE_PATH, globals);
  const service = new StateService();
  let reloads = 0;
  service.scheduleSongReload = () => {
    reloads += 1;
  };
  service.connectSocket();
  const socket = service.ws;
  const snapshot = (reason) =>
    socket.emit('message', {
      data: JSON.stringify({ type: 'snapshot', reason, state: {} }),
    });

  snapshot('cloud:songs');
  snapshot('songs:created');
  snapshot('live:status');
  assert.equal(reloads, 2);
});

test('Admin emits a fresh HTTP lyric version once and ignores duplicate or stale versions', async () => {
  const states = [
    { generation: 4, sequence: 1, text: 'fresh' },
    { generation: 4, sequence: 1, text: 'duplicate' },
    { generation: 3, sequence: 9, text: 'stale' },
  ];
  const globals = createGlobals(async () => ({
    json: async () => ({ ok: true, data: { lyricState: states.shift() } }),
  }));
  const { StateService } = await loadModuleExports(STATE_PATH, globals);
  const service = new StateService();

  await service.reloadState();
  await service.reloadState();
  await service.reloadState();

  assert.deepEqual(
    globals.events.filter((event) => event.type === 'app:lyric-state').map((event) => event.detail),
    [{ generation: 4, sequence: 1, text: 'fresh' }],
  );
  assert.equal(service.appState.lyricState.text, 'fresh');
});
