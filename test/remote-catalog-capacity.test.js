'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');
const { CACHE_FILE_NAME } = require('../src/bilibili/gift/remote-catalog-cache');
const { createRemoteGiftCatalogCache, QUIET_LOGGER, UPDATED_AT } = require('./helpers/remote-catalog-fixture');

const CATALOG_LIMIT = 32 * 1024 * 1024;

test('catalog accepts exactly 32 MiB of UTF-8 JSON', async () => {
  const empty = JSON.stringify({ ok: true, padding: '' });
  const padding = ' '.repeat(CATALOG_LIMIT - Buffer.byteLength(empty));
  const body = JSON.stringify({ ok: true, padding });
  assert.equal(Buffer.byteLength(body), CATALOG_LIMIT);
  const client = createRemoteLicenseClient({ fetchImpl: async () => new Response(body) });
  assert.equal((await client.getGiftCatalog()).padding.length, padding.length);
});

test('over-limit streaming catalog is cancelled and the previous memory and disk catalog survive', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-catalog-capacity-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let overflow = false;
  let cancelled = false;
  let pulls = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  const client = createRemoteLicenseClient({
    fetchImpl: async () => {
      if (!overflow) return new Response(JSON.stringify({
        ok: true, version: 'known-good', updatedAt: UPDATED_AT,
        gifts: [{ id: '1001', name: 'Saved gift', priceRaw: 1000, coinType: 'gold' }],
      }), { headers: { ETag: '"known-good"' } });
      return new Response(new ReadableStream({
        pull(controller) {
          pulls += 1;
          controller.enqueue(pulls <= 32 ? chunk : new Uint8Array([32]));
          if (pulls === 34) controller.close();
        },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 }));
    },
  });
  const cache = createRemoteGiftCatalogCache({
    dataDir, logger: QUIET_LOGGER, fetchRemote: ({ etag }) => client.getGiftCatalog(etag),
  });
  t.after(() => cache.stop());
  await cache.refresh({ force: true });
  const previous = cache.getSnapshot();
  const cachePath = path.join(dataDir, 'cache', CACHE_FILE_NAME);
  const persisted = fs.readFileSync(cachePath);
  overflow = true;
  await assert.rejects(cache.refresh({ force: true }), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
  assert.equal(pulls, 33);
  assert.deepEqual(cache.getSnapshot(), previous);
  assert.deepEqual(fs.readFileSync(cachePath), persisted);
  assert.equal(cache.getGift('1001').name, 'Saved gift');
  overflow = false;
  await cache.refresh({ force: true });
  assert.equal(cache.getGift('1001').name, 'Saved gift');
});
