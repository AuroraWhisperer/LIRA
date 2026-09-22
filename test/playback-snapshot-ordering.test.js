'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createPlaybackStore } = require('../src/storage/playback-store');
const { MUSIC_SCHEMA } = require('../src/storage/schema');
const { routes } = require('../src/server/routes/playback-routes');
const { registerMusicIpc } = require('../src/electron/ipc/music-ipc');
const { loadModuleExports } = require('./helpers/frontend-modules');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(MUSIC_SCHEMA);
  t.after(() => db.close());
  return { db, store: createPlaybackStore(db) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function post(store, url, body) {
  let statusCode;
  let result;
  await routes[`POST ${url}`](
    { playback: store },
    { query: new URLSearchParams(), body: async () => body },
    {
      writeHead(status) {
        statusCode = status;
      },
      end(text) {
        result = JSON.parse(text);
      },
    },
  );
  return { statusCode, result };
}

async function sender(store, options = {}) {
  const bootWriter = store.beginQueueStateSession();
  const stateModule = await loadModuleExports(path.resolve(__dirname, '../public/js/playback/state/manager.js'));
  const state = stateModule.createInitialState();
  state.current = { id: 'test-track', source: 'qq', title: 'Test track' };
  const audio = { readyState: 1, currentTime: 17 };
  const calls = { http: [], ipc: [], beacon: [], sessions: [] };
  const beaconSaves = [];
  const ipcHandlers = new Map();
  const timers = new Map();
  let timerId = 0;
  registerMusicIpc({
    ipcMain: {
      handle(name, run) {
        ipcHandlers.set(name, run);
      },
    },
    writePlaybackSnapshot(payload, clientId) {
      return store.saveQueueState(payload, { clientId });
    },
  });
  const module = await loadModuleExports(
    path.resolve(__dirname, '../public/js/playback/operations/state-persistence.js'),
    {
      Blob,
      setTimeout(run) {
        timers.set(++timerId, run);
        return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      window: {
        __API_TOKEN__: 'test-token',
        __PLAYBACK_SNAPSHOT_WRITER__: bootWriter,
        musicAPI:
          options.ipc === false
            ? undefined
            : {
                async savePlaybackState(clientId, payload) {
                  calls.ipc.push(payload);
                  if (options.beforeIpc) await options.beforeIpc();
                  return ipcHandlers.get('playback:save-state')({}, { clientId, payload });
                },
              },
      },
      navigator:
        options.beacon === false
          ? {}
          : {
              sendBeacon(url, blob) {
                const save = blob.text().then(async (text) => {
                  const body = JSON.parse(text);
                  calls.beacon.push(body);
                  return post(store, url.split('?')[0], body);
                });
                beaconSaves.push(save);
                return true;
              },
            },
      async fetch(url, init) {
        const body = JSON.parse(init.body);
        if (url.endsWith('/session')) {
          calls.sessions.push(body);
          if (options.beforeSession) await options.beforeSession();
        } else {
          calls.http.push(body);
          if (options.beforeHttp) await options.beforeHttp();
        }
        const { statusCode, result } = await post(store, url, body);
        return { ok: statusCode === 200, json: async () => result };
      },
    },
  );
  const persistence = module.createStatePersistence({
    playbackState: state,
    getPlaybackAudio: () => audio,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    audio,
    calls,
    persistence,
    state,
    rebuild() {
      return module.createStatePersistence({
        playbackState: state,
        getPlaybackAudio: () => audio,
      });
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.all(beaconSaves);
    },
  };
}

test('a delayed old session cannot take ownership from a newer page', async (t) => {
  const { store } = fixture(t);
  const oldSession = deferred();
  t.after(() => oldSession.resolve());
  const old = await sender(store, { beforeSession: () => oldSession.promise });
  const current = await sender(store);
  current.audio.currentTime = 42;
  current.persistence.savePlaybackState();
  await current.persistence.flushPlaybackStateSave();
  old.audio.currentTime = 11;
  old.persistence.savePlaybackState();
  old.persistence.flushPlaybackStateOnUnload();
  oldSession.resolve();
  await old.settle();
  assert.equal(store.getQueueState().payload.currentTime, 42);
  current.audio.currentTime = 43;
  current.persistence.savePlaybackState();
  await current.persistence.flushPlaybackStateSave();
  assert.equal(store.getQueueState().payload.currentTime, 43);
});

test('an initial session failure cannot discard an empty-current queue snapshot', async (t) => {
  const { store } = fixture(t);
  const initialSession = deferred();
  t.after(() => initialSession.resolve());
  const app = await sender(store, {
    beforeSession: async () => {
      await initialSession.promise;
      throw new Error('Temporary handshake failure');
    },
  });
  app.state.current = null;
  app.state.normalQueue = [{ id: 'queued', source: 'qq', title: 'Retained queue' }];
  app.persistence.savePlaybackState();
  const initial = app.persistence.flushPlaybackStateSave();
  initialSession.resolve();
  await initial;
  await app.persistence.flushPlaybackStateForShutdown();
  assert.equal(store.getQueueState()?.payload.normalQueue[0].id, 'queued');
});

test('unload sends its actual snapshot synchronously without awaiting a session request', async (t) => {
  const { store } = fixture(t);
  const session = deferred();
  t.after(() => session.resolve());
  const app = await sender(store, { beforeSession: () => session.promise });
  app.persistence.savePlaybackState();
  app.persistence.flushPlaybackStateOnUnload();
  assert.equal(app.calls.ipc.length, 1);
  assert.equal(app.calls.ipc[0].currentTime, 17);
});

test('late HTTP cannot overwrite the newer shared IPC/beacon unload snapshot', async (t) => {
  const { db, store } = fixture(t);
  const oldHttp = deferred();
  const app = await sender(store, { beforeHttp: () => oldHttp.promise });
  app.persistence.savePlaybackState();
  const periodicSave = app.persistence.flushPlaybackStateSave();
  await app.settle();
  assert.equal(app.calls.http[0].payload.currentTime, 17);

  app.audio.currentTime = 42;
  app.persistence.savePlaybackState();
  app.persistence.flushPlaybackStateOnUnload();
  await app.settle();
  const unload = store.getQueueState();
  const changesBeforeOldRequest = db.prepare('SELECT total_changes() AS count').get().count;
  assert.equal(unload.payload.currentTime, 42);
  assert.deepEqual(
    app.calls.beacon[0].payload.snapshotVersion,
    JSON.parse(JSON.stringify(app.calls.ipc[0].snapshotVersion)),
  );
  assert.equal(app.calls.beacon[0].payload.snapshotVersion.sequence, 2);

  oldHttp.resolve();
  await periodicSave;
  assert.deepEqual(store.getQueueState(), unload);
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changesBeforeOldRequest);
  const duplicate = await post(store, '/api/playback/queue-state', app.calls.beacon[0]);
  assert.equal(duplicate.result.data.duplicate, true);
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changesBeforeOldRequest);
});

test('beacon-first delivery cannot be replaced by a later duplicate IPC save', async (t) => {
  const { db, store } = fixture(t);
  const ipc = deferred();
  const app = await sender(store, { beforeIpc: () => ipc.promise });
  app.persistence.savePlaybackState();
  app.persistence.flushPlaybackStateOnUnload();
  await app.settle();
  const saved = store.getQueueState();
  const changes = db.prepare('SELECT total_changes() AS count').get().count;
  ipc.resolve();
  await app.settle();
  assert.deepEqual(store.getQueueState(), saved);
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changes);
});

test('rebuilt senders start at sequence one with a new writer and reject the old sender', async (t) => {
  const { store } = fixture(t);
  const first = await sender(store);
  first.persistence.savePlaybackState();
  await first.persistence.flushPlaybackStateSave();
  const initial = store.getQueueState().payload.snapshotVersion;
  const rebuilt = await sender(store);
  rebuilt.audio.currentTime = 51;
  rebuilt.persistence.savePlaybackState();
  await rebuilt.persistence.flushPlaybackStateSave();
  const next = store.getQueueState().payload.snapshotVersion;
  assert.equal(next.sequence, 1);
  assert.equal(next.generation, initial.generation + 1);
  assert.notEqual(next.writerId, initial.writerId);

  first.audio.currentTime = 23;
  first.persistence.savePlaybackState();
  await first.persistence.flushPlaybackStateSave();
  assert.equal(store.getQueueState().payload.currentTime, 51);
  assert.equal(first.calls.sessions.length, 0, 'a retired sender must not reclaim ownership');
});

test('shutdown commits through IPC without a separate session request', async (t) => {
  const { store } = fixture(t);
  const session = deferred();
  const app = await sender(store, { beforeSession: () => session.promise });
  app.audio.currentTime = 62;
  app.persistence.savePlaybackState();
  const shutdown = app.persistence.flushPlaybackStateForShutdown();
  await app.settle();
  assert.equal(app.calls.ipc.length, 1);
  session.resolve();
  await shutdown;
  assert.equal(app.calls.sessions.length, 0);
  assert.equal(store.getQueueState().payload.currentTime, 62);
  assert.equal(store.getQueueState().payload.snapshotVersion.sequence, 1);
});

test('browser unload fallback uses the same ordered protocol', async (t) => {
  const { store } = fixture(t);
  const app = await sender(store, { ipc: false, beacon: false });
  app.persistence.savePlaybackState();
  app.persistence.flushPlaybackStateOnUnload();
  await app.settle();
  assert.equal(app.calls.http.length, 1);
  assert.equal(store.getQueueState().payload.snapshotVersion.sequence, 1);
});

test('a failed HTTP save retains an empty-current queue for shutdown', async (t) => {
  const { store } = fixture(t);
  let attempts = 0;
  const app = await sender(store, {
    beforeHttp() {
      if (++attempts === 1) throw new Error('Temporary connection failure');
    },
  });
  assert.equal(store.getQueueState(), null);
  assert.equal(app.calls.http.length, 0);
  app.state.current = null;
  app.state.normalQueue = [{ id: 'retry-queue', source: 'qq', title: 'Retry queue' }];
  app.persistence.savePlaybackState();
  await app.persistence.flushPlaybackStateSave();
  assert.equal(store.getQueueState(), null);
  await app.persistence.flushPlaybackStateForShutdown();
  assert.equal(attempts, 1);
  assert.equal(store.getQueueState().payload.normalQueue[0].id, 'retry-queue');
  assert.equal(store.getQueueState().payload.snapshotVersion.sequence, 1);
});

test('a failed older HTTP save cannot displace a newer pending snapshot', async (t) => {
  const { store } = fixture(t);
  const failed = deferred();
  const app = await sender(store, {
    beforeHttp: async () => {
      await failed.promise;
      throw new Error('offline');
    },
  });
  app.persistence.savePlaybackState();
  const oldSave = app.persistence.flushPlaybackStateSave();
  app.audio.currentTime = 42;
  app.persistence.savePlaybackState();
  failed.resolve();
  await oldSave;
  await app.persistence.flushPlaybackStateForShutdown();
  assert.equal(store.getQueueState().payload.currentTime, 42);
  assert.equal(store.getQueueState().payload.snapshotVersion.sequence, 2);
});

test('same-page factory rebuilds claim a higher sender generation synchronously', async (t) => {
  const { store } = fixture(t);
  const app = await sender(store);
  app.persistence.savePlaybackState();
  await app.persistence.flushPlaybackStateSave();
  const previous = store.getQueueState().payload.snapshotVersion;
  const rebuilt = app.rebuild();
  app.audio.currentTime = 42;
  rebuilt.savePlaybackState();
  await rebuilt.flushPlaybackStateSave();
  const current = store.getQueueState().payload.snapshotVersion;
  assert.equal(current.generation, previous.generation);
  assert.equal(current.writerId, previous.writerId);
  assert.equal(current.senderGeneration, previous.senderGeneration + 1);
  assert.equal(current.sequence, 1);
  app.audio.currentTime = 17;
  app.persistence.savePlaybackState();
  app.persistence.flushPlaybackStateOnUnload();
  await app.settle();
  assert.equal(store.getQueueState().payload.currentTime, 42);
});

for (const newerSavedBeforeFailure of [false, true]) {
  test(`an old HTTP failure cannot replace a newer ${newerSavedBeforeFailure ? 'committed' : 'in-flight'} snapshot before shutdown`, async (t) => {
    const { store } = fixture(t);
    const failed = deferred();
    const newer = deferred();
    let attempts = 0;
    const app = await sender(store, {
      beforeHttp: async () => {
        if (++attempts === 1) {
          await failed.promise;
          throw new Error('offline');
        }
        await newer.promise;
      },
    });
    app.persistence.savePlaybackState();
    const oldSave = app.persistence.flushPlaybackStateSave();
    app.audio.currentTime = 42;
    app.persistence.savePlaybackState();
    const currentSave = app.persistence.flushPlaybackStateSave();
    if (newerSavedBeforeFailure) {
      newer.resolve();
      await currentSave;
    }
    failed.resolve();
    await oldSave;
    newer.resolve();
    await currentSave;
    app.audio.currentTime = 72;
    await app.persistence.flushPlaybackStateForShutdown();
    assert.equal(app.calls.ipc[0].currentTime, 72);
    assert.equal(store.getQueueState().payload.currentTime, 72);
  });
}

test('shutdown HTTP fallback preserves the failed IPC snapshot version', async (t) => {
  const { store } = fixture(t);
  const app = await sender(store, {
    beforeIpc() {
      throw new Error('IPC unavailable');
    },
  });
  app.audio.currentTime = 72;
  app.persistence.savePlaybackState();
  await app.persistence.flushPlaybackStateForShutdown();
  assert.equal(store.getQueueState().payload.currentTime, 72);
  assert.deepEqual(
    app.calls.http[0].payload.snapshotVersion,
    JSON.parse(JSON.stringify(app.calls.ipc[0].snapshotVersion)),
  );
  assert.equal(app.calls.sessions.length, 0);
});

test('persisted writer generations survive reopening the database and remain client scoped', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-playback-order-'));
  const filename = path.join(directory, 'music-data.db');
  let db = new DatabaseSync(filename);
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  db.exec(MUSIC_SCHEMA);
  let store = createPlaybackStore(db);
  const first = store.beginQueueStateSession();
  const snapshot = { currentTime: 37, snapshotVersion: { ...first, sequence: 5 } };
  store.saveQueueState(snapshot);
  const unusedBoot = store.beginQueueStateSession();
  db.close();
  db = new DatabaseSync(filename);
  store = createPlaybackStore(db);
  assert.equal(store.getQueueState().payload.currentTime, 37);
  assert.equal(store.saveQueueState(snapshot).duplicate, true);
  assert.equal(
    store.saveQueueState({
      currentTime: 12,
      snapshotVersion: { ...first, sequence: 4 },
    }).saved,
    false,
  );

  const restarted = store.beginQueueStateSession();
  assert.equal(restarted.generation, unusedBoot.generation + 1);
  assert.notEqual(restarted.writerId, first.writerId);
  assert.equal(store.getQueueState().payload.currentTime, 37);
  assert.equal(
    store.saveQueueState({
      currentTime: 38,
      snapshotVersion: { ...restarted, sequence: 1 },
    }).saved,
    true,
  );
  assert.equal(
    store.saveQueueState({
      currentTime: 100,
      snapshotVersion: { ...first, sequence: 1000 },
    }).saved,
    false,
  );
  const independent = store.beginQueueStateSession({ clientId: 'other-client' });
  assert.equal(independent.generation, 1);
  assert.equal(
    store.saveQueueState(
      {
        currentTime: 90,
        snapshotVersion: { ...independent, sequence: 1 },
      },
      { clientId: 'other-client' },
    ).saved,
    true,
  );
  assert.equal(store.getQueueState().payload.currentTime, 38);
});

test('allocator-only rows remain invisible and their high water survives clear and store recreation', (t) => {
  const { db, store } = fixture(t);
  const allocated = store.beginQueueStateSession();
  assert.equal(store.getQueueState(), null);
  store.clearQueueState();
  assert.equal(store.getQueueState(), null);
  const restarted = createPlaybackStore(db);
  const next = restarted.beginQueueStateSession();
  assert.equal(next.generation, allocated.generation + 1);
  assert.equal(restarted.getQueueState(), null);
  assert.equal(
    restarted.saveQueueState({
      currentTime: 37,
      issuedGeneration: 999,
      snapshotVersion: { ...allocated, sequence: 1 },
    }).saved,
    true,
  );
  const afterClientMetadata = restarted.beginQueueStateSession();
  assert.equal(afterClientMetadata.generation, next.generation + 1);
  assert.equal(restarted.getQueueState().payload.issuedGeneration, undefined);
});

test('legacy snapshots restore and accept saves until an ordered writer takes ownership', (t) => {
  const { store } = fixture(t);
  const legacy = { currentTime: 9, mode: 'repeat-one', volume: 0.5 };
  assert.equal(store.saveQueueState(legacy).saved, true);
  assert.deepEqual(store.getQueueState().payload, legacy);
  store.clearQueueState();
  assert.equal(store.getQueueState(), null);
  assert.equal(store.saveQueueState(legacy).saved, true);

  const session = store.beginQueueStateSession();
  assert.equal(store.getQueueState().payload.currentTime, 9);
  assert.equal(store.saveQueueState({ currentTime: 1 }).saved, true);
  assert.equal(
    store.saveQueueState({
      currentTime: 10,
      snapshotVersion: { ...session, sequence: 1 },
    }).saved,
    true,
  );
  assert.equal(store.saveQueueState({ currentTime: 1 }).saved, false);
  store.clearQueueState();
  assert.equal(store.getQueueState(), null);
  assert.equal(
    store.saveQueueState({
      currentTime: 10,
      snapshotVersion: { ...session, sequence: 1 },
    }).duplicate,
    true,
  );
  assert.equal(store.getQueueState(), null);
  assert.equal(
    store.saveQueueState({
      currentTime: 11,
      snapshotVersion: { ...session, sequence: 2 },
    }).saved,
    true,
  );
});

test('malformed versions and unissued generations cannot bypass the owner', async (t) => {
  const { store } = fixture(t);
  const session = store.beginQueueStateSession();
  store.saveQueueState({ currentTime: 17, snapshotVersion: { ...session, sequence: 1 } });
  for (const version of [
    null,
    { ...session, sequence: '1' },
    { ...session, sequence: -1 },
    { ...session, generation: Number.MAX_SAFE_INTEGER + 1, sequence: 1 },
  ]) {
    const result = await post(store, '/api/playback/queue-state', {
      payload: { currentTime: 200, snapshotVersion: version },
    });
    assert.equal(result.statusCode, 400);
  }
  for (const version of [
    { ...session, writerId: 'another-writer', sequence: 1 },
    { ...session, generation: session.generation + 1, sequence: 1 },
  ]) {
    assert.equal(
      store.saveQueueState({
        currentTime: 200,
        snapshotVersion: version,
      }).saved,
      false,
    );
  }
  assert.equal(store.getQueueState().payload.currentTime, 17);
});
