'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createSettingsStore } = require('../../src/storage/settings-store');
const { createSongStore } = require('../../src/storage/song-store');
const { createCloudSongSyncStore } = require('../../src/storage/cloud-song-sync-store');
const songService = require('../../src/music/song-service');
const { listenHttpServer } = require('../helpers/transport-fixtures');
const { postJson } = require('../helpers/local-api-client');
const { createScratchDirectory } = require('../helpers/scratch-directory');

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const settings = createSettingsStore(db);
  const songs = createSongStore(db);
  const sync = createCloudSongSyncStore(db);
  const accountKey = name => JSON.stringify(['https://api.example.test', name, name === 'first' ? 1 : 2]);
  let owner;
  let authorized = true;
  let admission = Promise.withResolvers();
  const context = {
    sessionToken: 'synthetic-account-token', maxBodyBytes: 1024 * 1024,
    songs: { save: input => songService.saveSong(songs, input) },
    settings: { defaults: settings.getDefaultSettings(), get: settings.getSettings, setMany: settings.setSettings },
    bilibili: { configure() {} }, broadcastSnapshot() {}, cloudSync: { request() {} },
    system: { getState: () => ({ settings: settings.getSettings() }) },
  };
  function select(name) {
    owner = { scope: name, epoch: (owner?.epoch || 0) + 1 };
    const key = accountKey(name);
    settings.prepareCloudRoomAccount(key);
    songService.replaceCloudSongs(songs, [{ title: `${name} library` }], key);
    settings.setSettings({ roomId: name === 'first' ? '1111' : '2222' }, { syncPending: false, accountKey: key });
  }
  select('first');
  const { origin } = await listenHttpServer(t, {
    isLicenseAuthorized: () => authorized,
    getRequestOwner: () => authorized ? owner : null,
    inflightTracker: { run: run => run() },
    createApiContext() { admission.resolve(); return context; },
  });
  return {
    context, settings, songs, sync, accountKey, origin, select,
    revoke() { authorized = false; },
    renew() { owner = { ...owner }; },
    post: (route, body) => postJson(origin, context.sessionToken, route, body),
    async pendingBody(route, body, method = 'POST', contentType = 'application/json') {
      admission = Promise.withResolvers();
      const bytes = Buffer.isBuffer(body) ? body : JSON.stringify(body);
      let request;
      const response = new Promise((resolve, reject) => {
        request = http.request(origin + route, { method, headers: {
          Authorization: `Bearer ${context.sessionToken}`, 'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(bytes),
        } }, res => {
          let payload = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { payload += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, payload: JSON.parse(payload) }));
          res.on('error', reject);
        });
        request.on('error', reject);
        request.flushHeaders();
      });
      t.after(() => request.destroy());
      await admission.promise;
      return () => { request.end(bytes); return response; };
    },
  };
}

test('HTTP writes keep their admitted account and authorization generation through body delivery', async t => {
  for (const change of ['switch', 'switch-back', 'revoke']) {
    await t.test(change, async t => {
      const f = await fixture(t);
      const finish = await f.pendingBody('/api/songs/save', { name: 'old request' });
      if (change === 'revoke') f.revoke();
      else {
        f.select('second');
        if (change === 'switch-back') f.select('first');
      }
      const response = await finish();
      assert.equal(response.status, change === 'revoke' ? 423 : 409);
      assert.equal(response.payload.code, 'REQUEST_AUTHORIZATION_CHANGED');
      assert.equal(f.songs.listRows().some(song => song.name === 'old request'), false);
      assert.equal(f.sync.readPending(f.accountKey('first')), null);
      assert.equal(f.sync.readPending(f.accountKey('second')), null);
    });
  }
});

test('same-account renewal preserves HTTP saves and their pending snapshot', async t => {
  const f = await fixture(t);
  const finish = await f.pendingBody('/api/songs/save', { name: 'current request' });
  f.renew();
  const response = await finish();
  assert.equal(response.status, 200);
  assert.equal(f.sync.readPending(f.accountKey('first')).songs.some(song => song.name === 'current request'), true);
});

test('route error wrappers preserve account-change responses from delayed JSON bodies', async t => {
  for (const route of [
    '/api/songs/import-preview', '/api/songs/import-apply', '/api/bilibili/danmaku/send',
    '/api/ai/personas/create', '/api/gifts/display-settings', '/api/theme/presets',
    '/api/music/wesing/configure', '/api/bilibili/dynamic-lottery/tasks', '/api/games/session',
  ]) {
    await t.test(route, async t => {
      const f = await fixture(t);
      f.context.dynamicLottery = {};
      f.context.ai = {};
      const finish = await f.pendingBody(route, { rows: [{ name: 'old import' }], message: 'old request' });
      f.select('second');
      const response = await finish();
      assert.equal(response.status, 409);
      assert.equal(response.payload.code, 'REQUEST_AUTHORIZATION_CHANGED');
      assert.equal(f.sync.readPending(f.accountKey('second')), null);
    });
  }
});

test('raw media and preview handlers reject an upload admitted by an earlier authorization', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=', 'base64');
  const multipart = Buffer.concat([
    Buffer.from('--account-test\r\nContent-Disposition: form-data; name="file"; filename="character.png"\r\nContent-Type: image/png\r\n\r\n'),
    png, Buffer.from('\r\n--account-test--\r\n'),
  ]);
  for (const [route, body, contentType] of [
    ['/api/scenes/text-image', png, 'image/png'],
    ['/api/opening/character', multipart, 'multipart/form-data; boundary=account-test'],
    ['/api/component-styles/config', { id: 'old-style', patch: {} }],
    ['/api/component-preview', { action: 'open', type: 'queue', config: {} }],
  ]) {
    await t.test(route, async t => {
      const f = await fixture(t);
      const dataDir = createScratchDirectory('http-account-upload-', t);
      f.context.system.dataDir = dataDir;
      const finish = await f.pendingBody(route, body, 'POST', contentType);
      const filesBefore = fs.readdirSync(dataDir, { recursive: true });
      f.revoke();
      const response = await finish();
      assert.equal(response.status, 423);
      assert.equal(response.payload.code, 'REQUEST_AUTHORIZATION_CHANGED');
      assert.equal(response.payload.error, 'LICENSE_REQUIRED');
      assert.deepEqual(fs.readdirSync(dataDir, { recursive: true }), filesBefore);
    });
  }
});

test('settings recheck the request after asynchronous capture preparation before committing', async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers();
  const prepared = Promise.withResolvers();
  let applied = false;
  f.context.weSing = { async prepareConfiguration() {
    entered.resolve();
    await prepared.promise;
    return { apply() { applied = true; } };
  } };
  const pending = f.post('/api/settings', { roomId: '3333', weSingLyricOffsetMs: 200 });
  await entered.promise;
  f.select('second');
  prepared.resolve();
  const { response } = await pending;
  assert.equal(response.status, 409);
  assert.equal(f.settings.getSettings().roomId, '2222');
  assert.equal(f.settings.getPendingCloudSettings(f.accountKey('second')), null);
  assert.equal(applied, false);
});

test('completed remote gift clearing cannot clear the next account local projection', async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers();
  const cleared = Promise.withResolvers();
  let localClears = 0;
  f.context.giftSync = { async clearRemote() { entered.resolve(); await cleared.promise; return { deletedCounts: {} }; } };
  f.context.data = { clearGifts() { localClears++; return {}; } };
  const pending = f.post('/api/database/clear-gifts', { confirm: true });
  await entered.promise;
  f.select('second');
  cleared.resolve();
  const { response } = await pending;
  assert.equal(response.status, 409);
  assert.equal(localClears, 0);
});

test('random HTTP requests carry their original authorization through asynchronous resolution', async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let inserted = false;
  f.context.queue = { async requestRandom({ authorize }) {
    entered.resolve();
    await release.promise;
    authorize();
    inserted = true;
    return { accepted: true, queueItem: {} };
  } };
  const pending = f.post('/api/queue/random', {});
  await entered.promise;
  f.select('second');
  release.resolve();
  const { response, payload } = await pending;
  assert.equal(response.status, 409);
  assert.equal(payload.code, 'REQUEST_AUTHORIZATION_CHANGED');
  assert.equal(inserted, false);
});

test('gift preview resolution cannot publish into the next authorization', async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers();
  const effect = Promise.withResolvers();
  let published = false;
  f.context.gifts = {
    resolveEffect() { entered.resolve(); return effect.promise; },
    previewEffect() { published = true; },
  };
  const pending = f.post('/api/gifts/effects/preview', { giftId: '1' });
  await entered.promise;
  f.select('second');
  effect.resolve({ url: 'https://media.example.test/gift.mp4' });
  const { response } = await pending;
  assert.equal(response.status, 409);
  assert.equal(published, false);
});

test('retention stops before another batch after the account changes during its yield', async t => {
  const f = await fixture(t);
  let batches = 0;
  f.context.data = { runRetention() {
    batches++;
    queueMicrotask(() => f.select('second'));
    return { hasMoreGiftEvents: true };
  } };
  const { response } = await f.post('/api/database/retention', { confirm: true });
  assert.equal(response.status, 409);
  assert.equal(batches, 1);
});
