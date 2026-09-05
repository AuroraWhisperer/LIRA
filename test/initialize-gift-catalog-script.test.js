'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { run } = require('../scripts/initialize-gift-catalog');
const { CACHE_FILE_NAME } = require('../src/bilibili/gift/remote-catalog-cache');
const { STATE_FILE_NAME } = require('../src/bilibili/gift/gift-catalog-initializer');

const QUIET_LOGGER = { debug() {}, warn() {} };

test('gift catalog CLI persists the versioned gold catalog and downloads its images', async (t) => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-catalog-cli-'),
  );
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const requests = [];
  const progress = [];
  const imageBytes = webpBytes();

  const result = await run({
    dataDir,
    baseUrl: 'https://api.example.test',
    quiet: true,
    logger: QUIET_LOGGER,
    onProgress: (state) => progress.push(state),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (url === 'https://api.example.test/api/public/gifts/catalog?schemaVersion=2') {
        assert.equal(options.headers.Authorization, undefined);
        return new Response(
          JSON.stringify({
            ok: true,
            schemaVersion: 2,
            blindBoxes: [],
            version: 'cli-v1',
            updatedAt: '2026-09-05T00:00:00.000Z',
            gifts: [
              {
                id: '7001',
                name: 'CLI 付费礼物',
                priceRaw: 100,
                coinType: 'gold',
                active: true,
                isBlindBox: false,
                sourceUrl:
                  'https://i0.hdslb.com/bfs/live/cli-paid.webp',
                imageUrl: '/gift-media/images/cli-paid.webp',
              },
              {
                id: '7002',
                name: 'CLI 免费礼物',
                priceRaw: 0,
                coinType: 'silver',
                active: true,
                isBlindBox: false,
                sourceUrl:
                  'https://i0.hdslb.com/bfs/live/cli-free.webp',
                imageUrl: '/gift-media/images/cli-free.webp',
              },
            ],
          }),
          {
            status: 200,
            headers: { ETag: '"cli-v1"' },
          },
        );
      }
      if (url === 'https://i0.hdslb.com/bfs/live/cli-paid.webp') {
        assert.equal(options.redirect, 'error');
        return new Response(imageBytes);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.total, 1);
  assert.equal(result.available, 1);
  assert.equal(progress.some((state) => state.phase === 'catalog'), true);
  assert.equal(progress.some((state) => state.phase === 'images'), true);
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      'https://api.example.test/api/public/gifts/catalog?schemaVersion=2',
      'https://i0.hdslb.com/bfs/live/cli-paid.webp',
    ],
  );

  const catalog = JSON.parse(
    fs.readFileSync(path.join(dataDir, CACHE_FILE_NAME), 'utf8'),
  );
  assert.equal(catalog.schemaVersion, 2);
  assert.deepEqual(catalog.blindBoxes, []);
  assert.deepEqual(catalog.gifts.map((gift) => gift.id), ['7001']);
  assert.equal(
    catalog.gifts[0].sourceUrl,
    'https://i0.hdslb.com/bfs/live/cli-paid.webp',
  );
  const imageDir = path.join(dataDir, 'overtime-gift-images');
  const index = JSON.parse(
    fs.readFileSync(path.join(imageDir, 'index.json'), 'utf8'),
  );
  assert.equal(index.schemaVersion, 1);
  assert.deepEqual(Object.keys(index.images), ['7001']);
  assert.deepEqual(
    fs.readdirSync(imageDir).sort(),
    [index.images['7001'], 'index.json'].sort(),
  );

  const completion = JSON.parse(
    fs.readFileSync(
      path.join(dataDir, STATE_FILE_NAME),
      'utf8',
    ),
  );
  assert.equal(completion.catalogVersion, 'cli-v1');
  assert.equal(completion.total, 1);
  assert.equal(completion.available, 1);
  assert.equal(completion.failed, 0);
});

function webpBytes() {
  const bytes = Buffer.alloc(16);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(8, 4);
  bytes.write('WEBP', 8, 'ascii');
  return bytes;
}
