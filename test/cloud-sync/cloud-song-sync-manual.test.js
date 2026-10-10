'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('../helpers/cloud-sync-controller-fixture');

test('manual sync fences an in-flight pull and uploads the complete current library', async (t) => {
  let finishPull;
  let songs = [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }];
  const f = createFixture({
    licenseManager: {
      getCloudSongs: () => new Promise((resolve) => { finishPull = resolve; }),
    },
    runtime: { getCloudSongsSnapshot: () => songs },
  });
  t.after(() => f.controller.dispose());
  const automatic = f.controller.start();
  while (!finishPull) await new Promise(setImmediate);
  assert.equal(f.controller.getLocalSongCount().count, 3);
  const manual = f.controller.syncCurrentSongs();
  songs = [...songs, { name: 'Added after confirmation' }];
  finishPull({ songs: [{ name: 'Old cloud' }], revision: 3 });
  await automatic;
  assert.equal((await manual).count, 4);
  assert.deepEqual(f.calls.filter(([op]) => op === 'push-songs'), [['push-songs', songs]]);
  assert.equal(f.calls.some(([op]) => op === 'apply-songs'), false);
});

test('legacy payload and current-library sync share the automatic queue', async (t) => {
  let finishUpload;
  const uploads = [];
  const f = createFixture({
    licenseManager: {
      syncSongs: async (songs) => {
        uploads.push(songs);
        if (uploads.length === 1) await new Promise((resolve) => { finishUpload = resolve; });
        return { count: songs.length, revision: uploads.length + 10 };
      },
    },
  });
  t.after(() => f.controller.dispose());
  const first = f.controller.syncCurrentSongs();
  while (!finishUpload) await new Promise(setImmediate);
  const legacy = f.controller.syncSongs([{ name: 'Explicit legacy payload' }]);
  const latest = f.controller.syncCurrentSongs();
  await new Promise(setImmediate);
  assert.equal(uploads.length, 1);
  finishUpload();
  await Promise.all([first, legacy, latest]);
  assert.deepEqual(uploads, [
    [{ name: 'Local song' }],
    [{ name: 'Explicit legacy payload' }],
    [{ name: 'Local song' }],
  ]);
});

test('failed manual sync preserves pending songs for an automatic retry and acknowledgement', async (t) => {
  let pending = { mutationId: 7, songs: [{ name: 'Pending local edit' }] };
  let attempts = 0;
  const acknowledgements = [];
  const f = createFixture({
    licenseManager: {
      syncSongs: async (songs) => {
        assert.equal(songs, pending.songs);
        if (++attempts === 1) throw Object.assign(new Error(), { code: 'NETWORK_UNAVAILABLE' });
        return { count: songs.length, revision: 6 };
      },
    },
    runtime: {
      getCloudSongsSnapshot: () => pending?.songs || [{ name: 'Pending local edit' }],
      getPendingCloudSongs: () => pending,
      acknowledgePendingCloudSongs: (_account, id) => { acknowledgements.push(id); pending = null; },
    },
  });
  t.after(() => f.controller.dispose());
  await assert.rejects(f.controller.syncCurrentSongs(), { code: 'NETWORK_UNAVAILABLE' });
  assert.deepEqual(acknowledgements, []);
  await f.controller.syncNow();
  assert.equal(attempts, 2);
  assert.deepEqual(acknowledgements, [7]);
  assert.equal(f.calls.some(([op]) => op === 'apply-songs'), false);
});

test('stopped manual work rejects and cannot acknowledge pending songs', async (t) => {
  let finishUpload;
  const acknowledgements = [];
  const f = createFixture({
    licenseManager: {
      syncSongs: () => new Promise((resolve) => { finishUpload = resolve; }),
    },
    runtime: {
      getPendingCloudSongs: () => ({ mutationId: 1, songs: [{ name: 'Pending' }] }),
      acknowledgePendingCloudSongs: (...args) => acknowledgements.push(args),
    },
  });
  t.after(() => f.controller.dispose());
  const pending = f.controller.syncCurrentSongs();
  while (!finishUpload) await new Promise(setImmediate);
  f.controller.stop();
  finishUpload({ count: 1, revision: 6 });
  await assert.rejects(pending, { code: 'CLOUD_SONGS_CHANGED' });
  assert.deepEqual(acknowledgements, []);
});

test('manual sync respects Retry-After before the queued automatic retry', async (t) => {
  let now = 1000;
  let attempts = 0;
  const error = Object.assign(new Error(), { code: 'RATE_LIMITED', retryAfterMs: 60_000 });
  const f = createFixture({
    now: () => now,
    licenseManager: {
      syncSongs: async (songs) => {
        if (++attempts === 1) throw error;
        return { ok: true, count: songs.length, revision: 6 };
      },
    },
  });
  t.after(() => f.controller.dispose());
  await assert.rejects(f.controller.syncCurrentSongs(), error);
  await assert.rejects(f.controller.syncCurrentSongs(), error);
  assert.equal(await f.controller.syncNow(), false);
  assert.equal(attempts, 1);
  now += error.retryAfterMs;
  await f.controller.syncNow();
  assert.equal(attempts, 2);
  assert.equal(f.calls.some(([op]) => op === 'apply-songs'), false);
});

test('confirmation from a previous authorization lifecycle cannot upload', async (t) => {
  const f = createFixture();
  t.after(() => f.controller.dispose());
  const preview = f.controller.getLocalSongCount();
  f.controller.stop();
  await assert.rejects(f.controller.syncCurrentSongs(preview.generation), { code: 'CLOUD_SONGS_CHANGED' });
  assert.equal(f.calls.some(([op]) => op === 'push-songs'), false);
});
