'use strict';

// Historical audit probes: exit 0 confirms the recorded defects, not correctness.
// Both checkout roots are explicit inputs. No real accounts, databases or upstream
// requests are used; the HTTP probe binds only an ephemeral loopback listener.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');

const [clientRoot, serverRoot] = process.argv.slice(2);
if (!clientRoot || !serverRoot || !path.isAbsolute(clientRoot) || !path.isAbsolute(serverRoot)) {
  throw new Error('Pass absolute client and server checkout paths.');
}
const clientRequire = createRequire(path.join(clientRoot, 'package.json'));
const serverRequire = createRequire(path.join(serverRoot, 'package.json'));
const { createHarness } = clientRequire('./test/helpers/license-manager-harness');
const { createRemoteLicenseClient, RemoteLicenseError } = clientRequire(
  './src/electron/license/remote-license-client',
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function switchToB(harness) {
  const streamer = { accountName: 'beta', subdomain: 'beta' };
  harness.remote.activate = async () => ({
    deviceId: 'device-b', licenseId: 'license-b', streamerId: 2, streamer,
  });
  harness.remote.verify = async () => ({
    accessToken: 'synthetic-token-b', expiresIn: '10m',
    deviceId: 'device-b', licenseId: 'license-b', streamer,
  });
  const response = await harness.manager.activate({
    accountName: 'beta', password: '123456', activationCode: 'ABCD-EFGH',
  });
  assert.equal(response.ok, true);
  assert.equal(harness.manager.getCloudSyncIdentity().streamerId, 2);
}

async function probeAccountSwitch(kind) {
  const harness = createHarness({
    identity: { deviceId: 'device-a', streamerId: 1, accountName: 'alpha', publicKeyPem: 'public' },
  });
  const delayed = deferred();
  const entered = deferred();
  const requests = [];
  try {
    await harness.manager.bootstrap();
    if (kind === 'write-retry') {
      harness.remote.syncSongs = async (songs, token) => {
        requests.push({ principal: token === 'synthetic-token-b' ? 'B' : 'A', title: songs[0].name });
        if (requests.length === 1) { entered.resolve(); return delayed.promise; }
        return { ok: true, count: songs.length };
      };
    } else if (kind === 'profile') {
      harness.remote.profile = async () => { entered.resolve(); return delayed.promise; };
    } else {
      harness.remote.getCloudSongs = async () => { entered.resolve(); return delayed.promise; };
    }
    const operation = kind === 'write-retry'
      ? harness.manager.syncSongs([{ name: 'A private song', artist: 'Synthetic' }])
      : kind === 'profile' ? harness.manager.getProfile() : harness.manager.getCloudSongs();
    const pending = operation.then(
      () => ({ success: true }),
      (error) => ({ success: false, error: error.code || error.message }),
    );
    await entered.promise;
    await switchToB(harness);
    if (kind === 'profile') delayed.resolve({ streamer: { accountName: 'alpha', subdomain: 'alpha' } });
    else delayed.reject(new RemoteLicenseError(
      kind === 'write-retry' ? 'DEVICE_TOKEN_INVALID' : 'DEVICE_REVOKED',
      'synthetic failure', { status: kind === 'write-retry' ? 401 : 403 },
    ));
    const result = await pending;
    const observed = {
      probe: kind, requests, ...result,
      currentIdentity: harness.manager.getCloudSyncIdentity(),
      displayedAccount: harness.manager.getSnapshot().streamer?.accountName,
      state: harness.manager.getState(),
    };
    if (kind === 'write-retry') {
      assert.deepEqual(requests.map((request) => request.principal), ['A', 'B']);
      assert.equal(result.success, true);
    } else if (kind === 'profile') {
      assert.equal(observed.currentIdentity.accountName, 'beta');
      assert.equal(observed.displayedAccount, 'alpha');
    } else assert.equal(observed.state, 'blocked');
    return observed;
  } finally { harness.manager.dispose(); }
}

async function probeSongRoundtrip() {
  const express = serverRequire('express');
  const Database = serverRequire('better-sqlite3');
  const { createApp } = serverRequire('./src/app');
  const store = serverRequire('./src/storage/song-library-store');
  const { createSongLibrarySyncService } = serverRequire('./src/modules/streamer/song-library-sync');
  const { mapSongForSync } = clientRequire('./src/electron/license/license-response-utils');
  const db = new Database(':memory:');
  let server;
  try {
    db.exec(`
      CREATE TABLE songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, artist TEXT,
        category_name TEXT, tags TEXT, language TEXT, source_platform TEXT,
        note TEXT, request_price TEXT, song_clip TEXT, extra_json TEXT,
        enabled INTEGER NOT NULL, sort_order INTEGER NOT NULL,
        created_at TEXT DEFAULT(datetime('now')), updated_at TEXT DEFAULT(datetime('now'))
      );
      CREATE TABLE song_page_settings (
        key TEXT PRIMARY KEY, value_json TEXT, updated_at TEXT DEFAULT(datetime('now'))
      );
    `);
    const service = createSongLibrarySyncService({ events: { publish() {} } });
    const routes = Object.fromEntries(
      ['adminAuth', 'admin', 'auth', 'device', 'streamerAuth', 'streamer', 'public']
        .map((name) => [name, express.Router()]),
    );
    // Route/auth wiring is a test adapter. Production parser, transaction, store,
    // serialization and desktop HTTP client remain real.
    routes.device.put('/songs/sync', (req, res) => res.json({
      ok: true, ...service.replaceSongs(1, db, req.body.songs, 'device', 'synthetic-device'),
    }));
    routes.device.get('/songs', (req, res) => res.json({
      songs: store.listSongs(db, true), ...store.getSongSyncState(db),
    }));
    const app = createApp({
      config: { env: 'test', trustProxy: false, baseDomain: 'example.test',
        adminHost: 'admin.example.test', apiHost: 'api.example.test', gamesBaseDomain: 'games.example.test' },
      logger: { error() {} }, routes,
      monitorManager: { getHealthSummary: () => ({ total: 0, wsConnected: 0, reconnects: 0 }) },
      resolveConsoleSession: () => ({ kind: 'anonymous' }), findStreamerBySubdomain: () => null,
      managementUrl: (pathname) => `https://admin.example.test${pathname}`,
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    const remote = createRemoteLicenseClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'https://api.example.test');
        return fetch(local + parsed.pathname, options);
      },
    });
    const songs = Array.from({ length: 5000 }, (_, index) => mapSongForSync({
      name: `Song ${index}`, artist: 'Synthetic', songClip: 'x'.repeat(210), requestPrice: 'Text price',
    }));
    const uploaded = await remote.syncSongs(songs, 'synthetic-token');
    const body = JSON.stringify({ songs: store.listSongs(db, true), ...store.getSongSyncState(db) });
    let download;
    try { download = { ok: true, count: (await remote.getCloudSongs('synthetic-token')).songs.length }; }
    catch (error) { download = { ok: false, error: error.code, retryable: error.retryable }; }
    assert.equal(uploaded.count, 5000);
    assert.equal(download.error, 'RESPONSE_TOO_LARGE');
    assert.equal(require.cache[serverRequire.resolve('./src/db')], undefined);
    return {
      probe: 'song-roundtrip', inputBytes: Buffer.byteLength(JSON.stringify({ songs })),
      responseBytes: Buffer.byteLength(body), uploaded: uploaded.count, download,
      requestCap: 2 * 1024 * 1024, responseCap: 4 * 1024 * 1024,
    };
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

(async () => {
  const results = [];
  for (const kind of ['write-retry', 'profile', 'late-rejection']) {
    results.push(await probeAccountSwitch(kind));
  }
  results.push(await probeSongRoundtrip());
  process.stdout.write(`${JSON.stringify({ auditedAt: new Date().toISOString(), results }, null, 2)}\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
