'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSettingsStore } = require('../src/storage/settings-store');
const { createSongStore } = require('../src/storage/song-store');
const { createCloudSongSyncStore } = require('../src/storage/cloud-song-sync-store');
const { clearSongLibraryData } = require('../src/storage/database-maintenance');
const songService = require('../src/music/song-service');
const { mapSongForSync } = require('../src/electron/license/license-response-utils');
const { createFixture } = require('./helpers/cloud-sync-controller-fixture');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const settings = createSettingsStore(db);
  const songs = createSongStore(db);
  const pending = createCloudSongSyncStore(db);
  let identity = { accountName: 'first', streamerId: 1 };
  let origin = 'https://api.example.test';
  let upload = async () => {};
  let pull = async () => {};
  let active;
  let replacements = 0;
  const uploads = [];
  const cloud = new Map();
  const key = () => JSON.stringify([origin, identity.accountName.toLowerCase(), identity.streamerId]);
  const currentCloud = () => cloud.get(key()) || { songs: [{ name: `Cloud ${identity.accountName}` }], revision: 1 };
  function restart() {
    active?.controller.dispose();
    active = createFixture({
      licenseManager: {
        getCloudSyncIdentity: () => identity,
        getRemoteBaseUrl: () => origin,
        getCloudState: async () => ({
          settings: { initialized: true, revision: 1, values: { giftBlindBoxConfig: [] } },
          songs: { initialized: true, revision: currentCloud().revision },
          bilibili: { initialized: false, revision: 0 },
        }),
        getCloudSongs: async () => {
          const snapshot = currentCloud();
          await pull();
          return snapshot;
        },
        syncSongs: async (input) => {
          const account = key();
          const snapshot = { songs: input.map(mapSongForSync), revision: currentCloud().revision + 1 };
          uploads.push({ account, ...snapshot });
          await upload();
          cloud.set(account, snapshot);
          return { initialized: true, revision: snapshot.revision };
        },
      },
      runtime: {
        prepareCloudRoomAccount: (account) => settings.prepareCloudRoomAccount(account),
        getCloudSongsSnapshot: () => songService.listSongs(songs),
        getPendingCloudSongs: (account) => pending.readPending(account),
        acknowledgePendingCloudSongs: (account, mutation) => pending.acknowledge(account, mutation),
        replaceCloudSongsSnapshot: (input) => {
          replacements += 1;
          return songService.replaceCloudSongs(songs, input);
        },
      },
    });
    return active.controller;
  }
  restart();
  t.after(() => { active.controller.dispose(); db.close(); });
  return {
    db, songs, pending, cloud, key, uploads, restart,
    get controller() { return active.controller; },
    get replacements() { return replacements; },
    setAccount(accountName, streamerId = 2) { identity = { accountName, streamerId }; },
    setOrigin(value) { origin = value; },
    setUpload(fn) { upload = fn; },
    setPull(fn) { pull = fn; },
    edit(name, notify = true) {
      songService.saveSong(songs, {
        name, categoryName: 'Local category', sourcePlatform: 'QQ音乐',
        isEnabled: false, requestPrice: '舰长', songClip: 'BV1',
      });
      if (notify) active.emitLocal('songs');
    },
    names() { return songs.listRows().map((song) => song.name).sort(); },
  };
}

test('failed uploads retain song edits across controller restarts until upload succeeds', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setUpload(async () => { throw new Error('OFFLINE'); });
  f.edit('Offline edit');
  await f.controller.whenIdle();
  const id = f.songs.listRows().find((song) => song.name === 'Offline edit').id;
  await f.restart().start();
  assert.deepEqual(f.names(), ['Cloud first', 'Offline edit']);
  assert.ok(f.pending.readPending(f.key()));
  assert.equal(f.songs.listRows().find((song) => song.name === 'Offline edit').id, id);
  f.setUpload(async () => {});
  await f.controller.syncNow();
  assert.deepEqual(f.cloud.get(f.key()).songs.map((song) => song.name).sort(), f.names());
  assert.equal(f.pending.readPending(f.key()), null);
});

for (const change of ['account', 'origin', 'recreated account']) {
  test(`switching ${change} preserves pending edits for their original owner`, async (t) => {
    const f = fixture(t);
    await f.controller.start();
    const firstKey = f.key();
    f.setUpload(async () => { throw new Error('OFFLINE'); });
    f.edit('Private first edit');
    await f.controller.whenIdle();
    if (change === 'account') f.setAccount('second');
    if (change === 'origin') f.setOrigin('https://other.example.test');
    if (change === 'recreated account') f.setAccount('first', 3);
    const count = f.uploads.length;
    await f.restart().start();
    assert.equal(f.names().includes('Private first edit'), false);
    assert.equal(f.uploads.length, count);
    f.edit('Second edit');
    await f.controller.whenIdle();
    const secondKey = f.key();
    f.setAccount('FIRST', 1);
    f.setOrigin('https://api.example.test');
    await f.restart().start();
    assert.deepEqual(f.names(), ['Cloud first', 'Private first edit']);
    const restored = f.songs.listRows().find((song) => song.name === 'Private first edit');
    assert.equal(restored.category_name, 'Local category');
    assert.equal(restored.source_platform, 'QQ音乐');
    assert.equal(restored.is_enabled, 0);
    assert.equal(restored.request_price, '舰长');
    assert.equal(restored.song_clip, 'BV1');
    assert.ok(f.pending.readPending(secondKey));
    f.setUpload(async () => {});
    await f.controller.syncNow();
    assert.equal(f.pending.readPending(firstKey), null);
    assert.ok(f.pending.readPending(secondKey));
  });
}

test('a committed edit without a dirty notification is recovered and cannot be overwritten by a late pull', async (t) => {
  const f = fixture(t);
  const waiting = Promise.withResolvers();
  const started = Promise.withResolvers();
  f.setPull(() => { started.resolve(); return waiting.promise; });
  const initial = f.controller.start();
  await started.promise;
  f.edit('Missed notification', false);
  waiting.resolve();
  await initial;
  assert.deepEqual(f.names(), ['Missed notification']);
  await f.controller.syncNow();
  assert.equal(f.cloud.get(f.key()).songs[0].name, 'Missed notification');
  assert.equal(f.pending.readPending(f.key()), null);
});

test('an older successful upload cannot acknowledge newer edits without a dirty notification', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const waiting = Promise.withResolvers();
  const started = Promise.withResolvers();
  f.setUpload(() => { started.resolve(); return waiting.promise; });
  f.edit('First edit');
  await started.promise;
  f.edit('Newer edit', false);
  waiting.resolve();
  await f.controller.whenIdle();
  assert.ok(f.pending.readPending(f.key()));
  assert.ok(f.names().includes('Newer edit'));
  await f.controller.syncNow();
  assert.equal(f.pending.readPending(f.key()), null);
  assert.ok(f.cloud.get(f.key()).songs.some((song) => song.name === 'Newer edit'));
});

test('disposal during upload retains its pending snapshot for a later controller', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const waiting = Promise.withResolvers();
  const started = Promise.withResolvers();
  f.setUpload(() => { started.resolve(); return waiting.promise; });
  f.edit('Interrupted edit');
  await started.promise;
  const old = f.controller;
  old.dispose();
  waiting.resolve();
  await old.whenIdle();
  assert.ok(f.pending.readPending(f.key()));
  f.setUpload(async () => {});
  await f.restart().start();
  assert.equal(f.pending.readPending(f.key()), null);
  assert.ok(f.names().includes('Interrupted edit'));
});

test('an intentional empty library remains empty after an offline clear and restart', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setUpload(async () => { throw new Error('OFFLINE'); });
  clearSongLibraryData(f.db);
  await f.restart().start();
  assert.deepEqual(f.names(), []);
  assert.deepEqual(f.pending.readPending(f.key()).songs, []);
  f.setUpload(async () => {});
  await f.controller.syncNow();
  assert.deepEqual(f.cloud.get(f.key()).songs, []);
  assert.equal(f.pending.readPending(f.key()), null);
});
