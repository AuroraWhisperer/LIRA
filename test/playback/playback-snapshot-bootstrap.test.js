'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createPlaybackStore } = require('../../src/storage/playback-store');
const { MUSIC_SCHEMA } = require('../../src/storage/schema');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { listenHttpServer } = require('../helpers/transport-fixtures');

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(MUSIC_SCHEMA);
  t.after(() => db.close());
  const store = createPlaybackStore(db);
  let bootCount = 0;
  const transport = createRuntimeTransport({
    publicDir: path.resolve(__dirname, '../../public'),
    getSessionToken: () => 'synthetic-token',
    beginPlaybackSnapshotSession() {
      bootCount += 1;
      return store.beginQueueStateSession();
    },
  });
  const { origin } = await listenHttpServer(t, { servePageOrAsset: transport.servePageOrAsset });
  return {
    store,
    bootCount: () => bootCount,
    async page(pathname, method = 'GET') {
      const response = await fetch(new URL(pathname, origin), {
        method,
        headers: { 'if-none-match': 'cached-page', authorization: 'Bearer synthetic-token' },
        redirect: 'manual',
      });
      const html = await response.text();
      const version = html.match(/window\.__PLAYBACK_SNAPSHOT_WRITER__=(\{[^;]+\});/);
      return { status: response.status, headers: response.headers, html, writer: version ? JSON.parse(version[1]) : null };
    },
  };
}

test('every composed admin alias receives a fresh uncached playback boot generation', async (t) => {
  const f = await fixture(t);
  let previous;
  for (const alias of ['/', '/admin', '/settings', '/songs', '/admin?section=playback']) {
    const page = await f.page(alias);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(page.writer);
    assert.ok(page.html.indexOf('__PLAYBACK_SNAPSHOT_WRITER__') < page.html.indexOf('</head>'));
    assert.equal(page.writer.generation, (previous?.generation || 0) + 1);
    if (previous) assert.notEqual(page.writer.writerId, previous.writerId);
    previous = page.writer;
  }
  const next = await f.page('/');
  assert.equal(next.writer.generation, previous.generation + 1);
  assert.notEqual(next.writer.writerId, previous.writerId);
});

test('HEAD, static scripts, standalone fragments and overlay visits do not retire the active player', async (t) => {
  const f = await fixture(t);
  const active = await f.page('/');
  const version = { ...active.writer, senderGeneration: 1, sequence: 1 };
  f.store.saveQueueState({ currentTime: 37, snapshotVersion: version });
  for (const alias of ['/', '/admin', '/settings', '/songs']) {
    const head = await f.page(alias, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.html, '');
  }
  for (const pathname of [
    '/queue',
    '/lyrics',
    '/license',
    '/js/playback/index.js',
    '/pages/admin/toolbox/settings.html',
    '/pages/admin/playback/page.html',
  ]) {
    const page = await f.page(pathname);
    assert.equal(page.status, 200, pathname);
    assert.equal(page.writer, null, pathname);
    if (pathname.endsWith('.js')) assert.match(page.headers.get('content-type'), /javascript/);
  }
  assert.equal(f.bootCount(), 1);
  assert.equal(
    f.store.saveQueueState({
      currentTime: 38,
      snapshotVersion: { ...version, sequence: 2 },
    }).saved,
    true,
  );
  assert.equal(f.store.getQueueState().payload.currentTime, 38);
});

for (const savedBeforeNextPage of [false, true]) {
  test(`an unexecuted admin HTML response preserves the ${savedBeforeNextPage ? 'active' : 'not-yet-saved'} sender`, async (t) => {
    const f = await fixture(t);
    const active = await f.page('/');
    const version = { ...active.writer, senderGeneration: 1, sequence: 1 };
    if (savedBeforeNextPage) {
      f.store.saveQueueState({ currentTime: 37, snapshotVersion: version });
    }
    const unopened = await f.page('/admin');
    assert.ok(unopened.writer.generation > active.writer.generation);
    assert.equal(
      f.store.saveQueueState({
        currentTime: 38,
        snapshotVersion: { ...version, sequence: 2 },
      }).saved,
      true,
    );
    assert.equal(f.store.getQueueState().payload.currentTime, 38);
    assert.equal(
      f.store.saveQueueState({
        currentTime: 42,
        snapshotVersion: { ...unopened.writer, senderGeneration: 1, sequence: 1 },
      }).saved,
      true,
    );
    assert.equal(
      f.store.saveQueueState({
        currentTime: 39,
        snapshotVersion: { ...version, sequence: 3 },
      }).saved,
      false,
    );
    assert.equal(f.store.getQueueState().payload.currentTime, 42);
  });
}

test('standalone persistence callers must supply an explicit boot writer', async () => {
  const module = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/playback/operations/state-persistence.js'),
  );
  assert.throws(() => module.createStatePersistence({}), /播放快照启动信息缺失/);
  assert.doesNotThrow(() =>
    module.createStatePersistence({
      snapshotWriter: { writerId: 'explicit-test-owner', generation: 1 },
    }),
  );
});
