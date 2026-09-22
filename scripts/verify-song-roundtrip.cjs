'use strict';

// Explicit integration entry point, deliberately outside default unit discovery:
// node scripts/verify-song-roundtrip.cjs <absolute-client-root> <absolute-server-root>
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const { resolveServerRoot } = require('./verify-server-contract');

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args.some((root) => !path.isAbsolute(root)))) {
  throw new Error('Pass no arguments or two absolute client and server checkout paths.');
}
const [clientRoot, serverRoot] = args.length === 2 ? args : [path.resolve(__dirname, '..'), resolveServerRoot()];
const clientRequire = createRequire(path.join(clientRoot, 'package.json'));
const { verifyServerContract, readServerFixture } = clientRequire('./scripts/verify-server-contract');
verifyServerContract({ serverRoot, runtime: true });
const serverRequire = createRequire(path.join(serverRoot, 'package.json'));
const { createRemoteLicenseClient } = clientRequire('./src/electron/license/remote-license-client');
const { mapSongForSync } = clientRequire('./src/electron/license/license-response-utils');
const express = serverRequire('express');
const Database = serverRequire('better-sqlite3');
const { createApp } = serverRequire('./src/app');
const store = serverRequire('./src/storage/song-library-store');
const { normalizeSong, MAX_SONG_SNAPSHOT_BYTES } = serverRequire('./src/lib/song-library');
const { createSongLibrarySyncService } = serverRequire('./src/modules/streamer/song-library-sync');
const budget = readServerFixture('docs/protocol/fixtures/song-snapshot-budget.json', { serverRoot });
assert.equal(MAX_SONG_SNAPSHOT_BYTES, budget.snapshotMaxBytes);

async function fixture(t) {
  const db = new Database(':memory:');
  let listener;
  t.after(async () => {
    if (listener?.listening) await new Promise((resolve) => listener.close(resolve));
    db.close();
    assert.equal(require.cache[serverRequire.resolve('./src/db')], undefined);
  });
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
  const events = [];
  const service = createSongLibrarySyncService({ events: { publish: (...args) => events.push(args) } });
  const routes = Object.fromEntries(
    ['adminAuth', 'admin', 'auth', 'device', 'streamerAuth', 'streamer', 'public'].map((name) => [
      name,
      express.Router(),
    ]),
  );
  // Authentication and route wiring are adapters here. Parser, domain service,
  // transaction, SQLite, DTO and desktop HTTP transport are production code.
  // Production auth/413 mappings have a separate server route regression.
  routes.device.put('/songs/sync', (req, res) => {
    try {
      res.json({ ok: true, ...service.replaceSongs(1, db, req.body.songs, 'device', 'synthetic-device') });
    } catch (error) {
      if (error.code === 'PAYLOAD_TOO_LARGE') return res.status(413).json({ error: error.code });
      if (['TOO_MANY_SONGS', 'INVALID_SONG', 'SONG_TITLE_REQUIRED'].includes(error.code)) {
        return res.status(400).json({ error: error.code, index: error.index });
      }
      throw error;
    }
  });
  const snapshot = () => ({ songs: store.listSongs(db, true), ...store.getSongSyncState(db) });
  routes.device.get('/songs', (req, res) => res.json(snapshot()));
  const app = createApp({
    config: {
      env: 'test',
      trustProxy: false,
      baseDomain: 'example.test',
      adminHost: 'admin.example.test',
      apiHost: 'api.example.test',
      gamesBaseDomain: 'games.example.test',
    },
    logger: { error: (...args) => assert.fail(JSON.stringify(args)) },
    routes,
    monitorManager: { getHealthSummary: () => ({ total: 0, wsConnected: 0, reconnects: 0 }) },
    resolveConsoleSession: () => ({ kind: 'anonymous' }),
    findStreamerBySubdomain: () => null,
    managementUrl: (pathname) => `https://admin.example.test${pathname}`,
  });
  listener = http.createServer(app);
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${listener.address().port}`;
  const remote = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://api.example.test');
      return fetch(local + parsed.pathname, options);
    },
  });
  return { db, remote, events, snapshot };
}

const aliases = {
  name: 'title',
  category_name: 'categoryName',
  source_platform: 'sourcePlatform',
  request_price: 'requestPrice',
  song_clip: 'songClip',
  isEnabled: 'enabled',
  is_enabled: 'enabled',
  sort_order: 'sortOrder',
};

async function assertRoundtrip(fixture, input) {
  const { remote, snapshot } = fixture;
  const inputBytes = Buffer.byteLength(JSON.stringify({ songs: input }));
  assert.ok(inputBytes <= budget.requestMaxBytes);
  const written = await remote.syncSongs(input, 'synthetic-token');
  const result = await remote.getCloudSongs('synthetic-token');
  assert.equal(result.songs.length, input.length);
  assert.equal(written.count, input.length);
  assert.equal(result.revision, written.revision);
  assert.equal(result.initialized, true);
  assert.deepEqual(result, snapshot());
  const expected = input
    .map((song, index) => normalizeSong(song, index))
    .sort((left, right) => left.sortOrder - right.sortOrder);
  result.songs.forEach((song, index) => {
    for (const field of [
      'title',
      'artist',
      'categoryName',
      'tags',
      'language',
      'sourcePlatform',
      'note',
      'requestPrice',
      'songClip',
      'sortOrder',
    ]) {
      assert.equal(song[field], expected[index][field], `${index}: ${field}`);
    }
    assert.equal(song.enabled, Boolean(expected[index].enabled));
    for (const [alias, canonical] of Object.entries(aliases)) {
      assert.equal(song[alias], song[canonical], `${index}: ${alias}`);
    }
  });
  const responseBytes = Buffer.byteLength(JSON.stringify(result));
  assert.ok(responseBytes <= budget.snapshotMaxBytes);
  return { inputBytes, responseBytes };
}

function auditSongs() {
  const sample = budget.cases.find((item) => item.id === 'audit-ascii-roundtrip');
  return Array.from({ length: sample.count }, (_, index) =>
    mapSongForSync({
      name: `Song ${index}`,
      artist: 'Synthetic',
      requestPrice: 'Text price',
      songClip: sample.songClip.repeat(sample.songClipRepeat),
    }),
  );
}

test('the historical 5000-song ASCII upload can now be read back with every legacy alias', async (t) => {
  const size = await assertRoundtrip(await fixture(t), auditSongs());
  assert.ok(size.responseBytes > budget.legacySnapshotMaxBytes);
  t.diagnostic(JSON.stringify(size));
});

test('exactly 2 MiB uploads roundtrip; one additional byte leaves the prior snapshot intact', async (t) => {
  const f = await fixture(t);
  const input = auditSongs();
  let remaining = budget.requestMaxBytes - Buffer.byteLength(JSON.stringify({ songs: input }));
  for (const song of input) {
    const added = Math.min(remaining, 1000 - song.songClip.length);
    song.songClip += 'x'.repeat(added);
    remaining -= added;
    if (!remaining) break;
  }
  assert.equal(remaining, 0);
  const size = await assertRoundtrip(f, input);
  assert.equal(size.inputBytes, budget.requestMaxBytes);
  const before = f.snapshot();
  const eventsBefore = f.events.length;
  input.at(-1).songClip += 'x';
  await assert.rejects(f.remote.syncSongs(input, 'synthetic-token'), {
    code: budget.rejection.error,
    status: budget.rejection.status,
    retryable: false,
  });
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.events.length, eventsBefore);
});

test('UTF-8, escaped controls, legacy input aliases and every text field boundary roundtrip', async (t) => {
  const f = await fixture(t);
  const sample = budget.cases.find((item) => item.id === 'utf8-json-escaping').text;
  const atLimit = (length) => `😀${'曲"\\\u0000'.repeat(length)}`.slice(0, length);
  const input = Array.from({ length: 64 }, (_, index) => ({
    name: atLimit(200),
    artist: atLimit(200),
    category_name: atLimit(120),
    tags: atLimit(500),
    language: atLimit(80),
    source_platform: atLimit(80),
    note: atLimit(1000),
    request_price: atLimit(1000),
    song_clip: atLimit(1000),
    is_enabled: index % 2 === 0,
    sort_order: index === 0 ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER,
  }));
  input.push({ name: sample, request_price: 12.5, song_clip: sample, sort_order: 0 });
  await assertRoundtrip(f, input);
});

test('normalizer expansion exceeding the response budget is rejected before commit', async (t) => {
  const f = await fixture(t);
  await assertRoundtrip(f, [mapSongForSync({ name: 'Original' })]);
  const before = f.snapshot();
  const metadataBefore = f.db.prepare('SELECT * FROM song_page_settings ORDER BY key').all();
  const eventsBefore = f.events.length;
  // Existing String(array) normalization can amplify a small JSON body. It must
  // never circumvent the complete response budget or overwrite the last snapshot.
  const repeatedObjects = Array.from({ length: 63 }, () => ({}));
  const input = Array.from({ length: 3000 }, () => ({
    title: 'Synthetic',
    songClip: repeatedObjects,
    note: repeatedObjects,
  }));
  assert.ok(Buffer.byteLength(JSON.stringify({ songs: input })) < budget.requestMaxBytes);
  await assert.rejects(f.remote.syncSongs(input, 'synthetic-token'), {
    code: budget.rejection.error,
    status: budget.rejection.status,
    retryable: false,
  });
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(f.db.prepare('SELECT * FROM song_page_settings ORDER BY key').all(), metadataBefore);
  assert.equal(f.events.length, eventsBefore);
  assert.deepEqual(await f.remote.getCloudSongs('synthetic-token'), before);
});

test('5001-song rejection and an empty replacement retain their transactional semantics', async (t) => {
  const f = await fixture(t);
  await assertRoundtrip(f, [{ name: 'Original' }]);
  const before = f.snapshot();
  await assert.rejects(
    f.remote.syncSongs(
      Array.from({ length: budget.maxSongs + 1 }, () => ({ name: 'Song' })),
      'synthetic-token',
    ),
    {
      code: 'TOO_MANY_SONGS',
      status: 400,
      retryable: false,
    },
  );
  assert.deepEqual(f.snapshot(), before);
  await assertRoundtrip(f, []);
});
