'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteGiftImageCache } = require('../../src/bilibili/gift/remote-gift-image-cache');
const { createHybridGiftSaleCatalogService } = require('../../src/bilibili/gift/hybrid-catalog');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const gift = { id: '12', variantId: `gv_${'a'.repeat(64)}`, sourceUrl: 'https://i0.hdslb.com/bfs/live/gift.png',
  imagePath: 'https://api.example.test/gift-media/images/gift.png' };

function setup(t, options = {}) {
  const dataDir = options.dataDir || createScratchDirectory('gift-image-resources-', t);
  const cache = createRemoteGiftImageCache({ dataDir, imageBaseUrl: 'https://api.example.test', logger: { debug() {} }, ...options });
  const catalog = createHybridGiftSaleCatalogService({ remoteImageCache: cache, now: options.now,
    local: { getSnapshot: () => ({ gifts: [] }), refresh: async () => null },
    remoteCatalog: { getRevision: () => '1', getSnapshot: () => ({ gifts: options.gifts || [gift] }), refresh: async () => null } });
  t.after(async () => { catalog.dispose(); await cache.dispose(); });
  return { dataDir, cache, resources: catalog.imageResources };
}

test('scene image requests share catalog downloads and reuse disk bytes offline after restart', async t => {
  let calls = 0, release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const downloading = new Promise(resolve => { started = resolve; });
  const { dataDir, cache, resources } = setup(t, { fetch: async () => { calls++; started(); await gate; return new Response(PNG); } });
  const imagePath = resources.resolveSource(gift.sourceUrl);
  assert.equal(calls, 0, 'mapping an event without displaying its image does not download');
  const server = await startComponentPreviewServer({ dataDir, ensureGiftImage: resources.ensureImage });
  t.after(server.close);
  assert.equal((await fetch(server.origin + imagePath, { method: 'HEAD' })).status, 404);
  assert.equal(calls, 0, 'HEAD does not start a download');
  const requests = [fetch(server.origin + imagePath), fetch(server.origin + imagePath)];
  const initialization = cache.cacheGiftImage(gift);
  await downloading;
  release();
  assert.equal(await initialization, imagePath);
  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    assert.match(response.headers.get('cache-control'), /immutable/);
  }
  assert.equal(calls, 1, 'startup and separate consumers share one upstream download');
  const restarted = setup(t, { dataDir, fetch: async () => { calls++; throw new Error('offline'); } });
  assert.equal(restarted.resources.resolveSource(gift.sourceUrl), imagePath);
  assert.equal(await restarted.resources.ensureImage(imagePath), imagePath);
  assert.equal(calls, 1, 'warm disk cache requires no upstream request after restart');
});

test('unregistered requests cannot download and failed sources cool down before recovering', async t => {
  let calls = 0, fail = true, now = 1000, authorized = true;
  const { dataDir, resources } = setup(t, { now: () => now,
    fetch: async () => { calls++; if (fail) throw new Error('offline'); return new Response(PNG); } });
  const server = await startComponentPreviewServer({ dataDir, ensureGiftImage: resources.ensureImage,
    isLicenseAuthorized: () => authorized });
  t.after(server.close);
  assert.equal(resources.resolveSource('https://127.0.0.1/private.png'), '');
  assert.equal((await fetch(`${server.origin}/overtime-gift-images/unregistered.png?url=${gift.sourceUrl}`)).status, 404);
  assert.equal(calls, 0);
  const imagePath = resources.resolveSource('https://i0.hdslb.com/bfs/live/new-gift.png');
  authorized = false;
  assert.equal((await fetch(server.origin + imagePath)).status, 404);
  assert.equal(calls, 0);
  authorized = true;
  assert.equal((await fetch(server.origin + imagePath)).status, 404);
  await Promise.all(Array.from({ length: 5 }, () => fetch(server.origin + imagePath)));
  assert.equal(calls, 1, 'failed images do not retry for every arriving gift');
  now += 30001; fail = false;
  assert.equal((await fetch(server.origin + imagePath)).status, 200);
  assert.equal(calls, 2);
  assert.notEqual(resources.resolveSource('https://i0.hdslb.com/bfs/live/new-version.png'), imagePath);
});

test('failed artwork updates redirect to the last good variant without freezing the old image at the new URL', async t => {
  let fail = false;
  const { dataDir, cache, resources } = setup(t, { fetch: async () => {
    if (fail) throw new Error('offline'); return new Response(PNG);
  } });
  const oldPath = await cache.cacheGiftImage({ ...gift, sourceUrl: 'https://i0.hdslb.com/bfs/live/old.png' });
  fail = true;
  const nextPath = resources.resolveSource(gift.sourceUrl);
  const server = await startComponentPreviewServer({ dataDir, ensureGiftImage: resources.ensureImage });
  t.after(server.close);
  const response = await fetch(server.origin + nextPath, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), oldPath);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(server.origin + oldPath)).status, 200);
  const ambiguous = setup(t, { dataDir, gifts: [gift, { ...gift, id: '13', variantId: `gv_${'b'.repeat(64)}` }],
    fetch: async () => { throw new Error('offline'); } });
  const ambiguousPath = ambiguous.resources.resolveSource(gift.sourceUrl);
  assert.equal(await ambiguous.resources.ensureImage(ambiguousPath), '',
    'a shared current URL does not identify which variant owns the older fallback');
});
