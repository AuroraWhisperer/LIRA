'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { routes } = require('../../src/server/routes/playback-routes');
const { createPlaybackStore } = require('../../src/storage/playback-store');
const { MUSIC_SCHEMA } = require('../../src/storage/schema');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { closestTarget, flushAsyncWork, track } = require('../helpers/playback-app');
const { invokeBodyRoute, invokeQueryRoute } = require('../helpers/route-invoke');
const { createClock, createDom } = require('../helpers/toast-dom');

function snapshot(name) {
  return {
    current: track(`${name}-current`, `${name} current`),
    normalQueue: [track(`${name}-next`, `${name} next`)],
    currentTime: 0, mode: 'sequence', selectedSource: 'qq', volume: 0.75,
  };
}

async function startPlayer(t, { initial = snapshot('authoritative'), local, failRead = false, failPost = false } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(MUSIC_SCHEMA);
  const store = createPlaybackStore(db);
  if (initial) store.saveQueueState({ ...initial, snapshotVersion: { ...store.beginQueueStateSession(), sequence: 1 } });
  const values = new Map();
  if (local) values.set('playbackState:v2', JSON.stringify(local));
  const clock = createClock();
  const { documentRef, windowRef, windowListeners } = createDom();
  const audio = documentRef.createElement('audio');
  Object.assign(audio, { currentTime: 0, readyState: 0, paused: true, dataset: {} });
  const volume = documentRef.createElement('input');
  volume.style.setProperty = () => {};
  const search = documentRef.createElement('button');
  const keyword = documentRef.createElement('input');
  const results = documentRef.createElement('div');
  const elements = new Map([
    ['music-player', audio], ['playbackVolume', volume], ['playbackSearchBtn', search],
    ['playbackSearchKeyword', keyword], ['playbackSearchResults', results],
  ]);
  documentRef.getElementById = id => elements.get(id) || null;
  documentRef.querySelector = () => null;
  documentRef.querySelectorAll = () => [];
  const saves = { postAt: [], ipc: 0 };
  let prepareShutdown;
  let acknowledged = false;
  windowRef.__PLAYBACK_SNAPSHOT_WRITER__ = store.beginQueueStateSession();
  windowRef.musicAPI = {
    onPrepareShutdown(listener) { prepareShutdown = listener; },
    confirmShutdownFlush() { acknowledged = true; },
    savePlaybackState(clientId, payload) {
      saves.ipc++;
      return store.saveQueueState(payload, { clientId });
    },
    getAuthState: async () => ({ loggedIn: false }),
    providerHealth: async () => ({ ok: true }),
  };
  const { createPlaybackController } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/controller.js'), {
    document: documentRef, window: windowRef, navigator: {},
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    localStorage: {
      get length() { return values.size; },
      key: index => [...values.keys()][index],
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
    async fetch(url, init = {}) {
      const { pathname, searchParams } = new URL(url, 'http://localhost');
      if (pathname === '/api/playback/queue-state') {
        if (init.method !== 'POST' && failRead) {
          failRead = false;
          return new Response(null, { status: 503 });
        }
        let response;
        if (init.method === 'POST') {
          saves.postAt.push(clock.now());
          if (failPost) {
            failPost = false;
            return new Response(null, { status: 503 });
          }
          response = await invokeBodyRoute(routes[`POST ${pathname}`], { playback: store }, JSON.parse(init.body));
        } else {
          response = await invokeQueryRoute(routes[`GET ${pathname}`], { playback: store }, searchParams);
        }
        return Response.json(response.body, { status: response.status });
      }
      const data = pathname === '/api/music/search' ? { tracks: [track('mid-playback', 'Mid-playback')] } : {};
      return Response.json({ ok: true, data });
    },
  });
  await createPlaybackController({ toast() {} }).init();
  await flushAsyncWork();
  return {
    audio, clock, saves, store,
    setVolume(value) {
      volume.value = String(value);
      return volume.fire('input', { target: volume });
    },
    async close() {
      await prepareShutdown();
      assert.ok(acknowledged);
      for (const listener of windowListeners.get('pagehide')) await listener();
      await flushAsyncWork();
    },
    async enqueue() {
      keyword.value = 'Mid-playback';
      await search.fire('click');
      await results.fire('click', {
        target: closestTarget({ playbackSearchAction: 'normal', playbackSearchIndex: '0' }, 'data-playback-search-action'),
      });
    },
  };
}

test('a failed startup read followed by unedited desktop shutdown preserves the authoritative SQLite queue', async (t) => {
  const local = { ...snapshot('stale'), volume: 0.4 };
  const app = await startPlayer(t, { local, failRead: true });
  assert.equal(app.audio.volume, local.volume);
  await app.audio.fire('pause');
  await app.close();
  assert.deepEqual(app.store.getQueueState().payload.normalQueue.map(item => item.id), ['authoritative-next']);
  assert.equal(app.saves.postAt.length + app.saves.ipc, 0);
});

test('a volume-only edit preserves an unconfirmed SQLite queue and persists after a successful read', async (t) => {
  const app = await startPlayer(t, { local: snapshot('stale'), failRead: true });
  await app.setVolume(0.25);
  assert.equal(app.audio.volume, 0.25);
  await app.close();
  assert.deepEqual(app.store.getQueueState().payload.normalQueue.map(item => item.id), ['authoritative-next']);
  assert.equal(app.saves.postAt.length + app.saves.ipc, 0);

  const confirmed = await startPlayer(t, { local: snapshot('stale') });
  await confirmed.setVolume(0.25);
  confirmed.clock.tick(1500);
  await flushAsyncWork();
  const saved = confirmed.store.getQueueState().payload;
  assert.equal(saved.volume, 0.25);
  assert.deepEqual(saved.normalQueue.map(item => item.id), ['authoritative-next']);
});

test('a confirmed empty SQLite snapshot migrates a local queue with no current track on close', async (t) => {
  const local = { ...snapshot('legacy'), current: null };
  const app = await startPlayer(t, { initial: null, local });
  await app.close();
  assert.deepEqual(app.store.getQueueState().payload.normalQueue.map(item => item.id), ['legacy-next']);
});

test('after a failed read without a local copy, a user enqueue can retry its failed save on shutdown', async (t) => {
  const app = await startPlayer(t, { failRead: true, failPost: true });
  await app.audio.fire('timeupdate');
  app.clock.tick(10000);
  assert.equal(app.saves.postAt.length, 0);
  await app.enqueue();
  app.clock.tick(1500);
  await flushAsyncWork();
  assert.equal(app.saves.postAt.length, 1);
  assert.deepEqual(app.store.getQueueState().payload.normalQueue.map(item => item.id), ['authoritative-next']);
  await app.close();
  assert.deepEqual(app.store.getQueueState().payload.normalQueue.map(item => item.id), ['mid-playback']);
});


test('a paused queue recovers from one unavailable save without another edit or shutdown', async (t) => {
  const app = await startPlayer(t, { failPost: true });
  await app.enqueue();
  app.clock.tick(1500);
  await flushAsyncWork();
  assert.deepEqual(app.store.getQueueState().payload.normalQueue.map(item => item.id), ['authoritative-next']);

  app.clock.tick(3000);
  await flushAsyncWork();
  assert.deepEqual(app.store.getQueueState().payload.normalQueue.map(item => item.id), ['authoritative-next', 'mid-playback']);
  assert.equal(app.saves.postAt.length, 2);
});

test('continuous timeupdate checkpoints a mid-playback enqueue to SQLite before exit', async (t) => {
  const app = await startPlayer(t);
  Object.assign(app.audio, { readyState: 1, paused: false });
  for (let tick = 0; tick < 88; tick++) {
    app.audio.currentTime = app.clock.now() / 1000;
    await app.audio.fire('timeupdate');
    if (app.clock.now() === 12000) await app.enqueue();
    app.clock.tick(250);
  }
  await flushAsyncWork();
  const saved = app.store.getQueueState().payload;
  const { postAt } = app.saves;
  t.diagnostic(`Queue-state POST times (ms) [${postAt.join(', ')}], durable progress ${saved.currentTime}s`);
  assert.deepEqual(saved.normalQueue.map(item => item.id), ['authoritative-next', 'mid-playback']);
  assert.ok(saved.currentTime >= 12);
  const times = [0, ...postAt, app.clock.now()];
  assert.ok(times.slice(1).every((time, index) => time - times[index] <= 10000));
  assert.ok(postAt.length <= Math.ceil(app.clock.now() / 1500));
});
