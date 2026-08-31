'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../src/server');

test('keeps the current room catalog primary and uses the server catalog only for search', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-overtime-'),
  );
  const giftSalePublicDir = createGiftSalePublicFixture(dataDir);
  let remoteCalls = 0;
  let receivedEtag = '';
  const runtime = createServerRuntime({
    dataDir,
    giftSalePublicDir,
    giftSaleGetRoomId: () => '22637261',
    giftSaleFetchJson: async (name) => {
      if (name === 'gift_data') {
        return {
          code: 0,
          data: { room_gift_list: { gold_list: [{ gift_id: 35793 }] } },
        };
      }
      return {
        code: 0,
        data: {
          list: [
            { id: 35793, name: '直播间礼物', price: 100, coin_type: 'gold' },
          ],
        },
      };
    },
    licenseGate: { isAuthorized: () => true },
  });

  try {
    const app = await runtime.start({
      host: '127.0.0.1',
      startPort: await findAvailablePort(),
      remoteGiftCatalog: {
        imageBaseUrl: 'https://api.lirahub.cn',
        fetch: async (request) => {
          remoteCalls += 1;
          receivedEtag = request.etag;
          return {
            ok: true,
            version: 'remote-1',
            updatedAt: '2026-08-29T08:00:00.000Z',
            stale: false,
            sources: {
              gifts: { asOf: '2026-08-29T08:00:00.000Z', stale: false },
              effects: { asOf: '2026-08-29T08:00:00.000Z', stale: false },
            },
            imageBaseUrl: 'https://api.lirahub.cn',
            etag: '"remote-1"',
            gifts: [
              {
                id: '987654321',
                name: '服务器礼物',
                priceRaw: 500,
                coinType: 'gold',
                bagGift: false,
                imageUrl: '/gift-media/images/server.webp',
              },
            ],
          };
        },
        fetchImage: async () => new Response(webpBytes()),
      },
    });
    const token = runtime.getApiToken();

    const response = await fetch(`${app.baseUrl}/api/overtime/gifts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.cached, true);
    assert.deepEqual(payload.data.gifts, []);
    assert.equal(remoteCalls, 0);

    const refreshed = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/refresh',
      {},
    );
    assert.equal(refreshed.response.status, 200);
    assert.deepEqual(refreshed.payload.data.gifts.map((gift) => gift.id), ['35793']);
    assert.equal(remoteCalls, 0);

    const searched = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/server/search',
      { query: '服务器' },
    );
    assert.equal(searched.response.status, 200);
    assert.deepEqual(searched.payload.data.gifts.map((gift) => gift.id), ['987654321']);
    assert.equal(
      searched.payload.data.gifts[0].imagePath,
      '/overtime-gift-images/server.webp',
    );
    assert.equal(remoteCalls, 1);
    assert.equal(receivedEtag, '');

    const savedRemoteRule = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/rules',
      {
        rules: [
          {
            giftId: '987654321',
            giftName: '服务器礼物',
            imagePath: '/overtime-gift-images/server.webp',
            mode: 'fixed',
            fixedSeconds: 60,
            quantityMode: 'item',
          },
        ],
      },
    );
    assert.equal(savedRemoteRule.response.status, 200);
    assert.equal(
      savedRemoteRule.payload.data.rules[0].imagePath,
      '/overtime-gift-images/server.webp',
    );
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server search forces a refresh and falls back to the previous remote cache', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-overtime-force-'),
  );
  const giftSalePublicDir = createGiftSalePublicFixture(dataDir);
  let remoteCalls = 0;
  let offline = false;
  const runtime = createServerRuntime({
    dataDir,
    giftSalePublicDir,
    licenseGate: { isAuthorized: () => true },
  });

  try {
    const app = await runtime.start({
      host: '127.0.0.1',
      startPort: await findAvailablePort(),
      remoteGiftCatalog: {
        imageBaseUrl: 'https://api.lirahub.cn',
        fetch: async () => {
          remoteCalls += 1;
          if (offline) throw new Error('offline');
          return {
            ok: true,
            version: 'manual-1',
            updatedAt: '2026-08-29T08:00:00.000Z',
            gifts: [
              {
                id: '987654322',
                name: '手动同步礼物',
                priceRaw: 100,
                coinType: 'gold',
              },
            ],
          };
        },
      },
    });
    const token = runtime.getApiToken();

    const first = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/server/search',
      { query: '手动同步' },
    );
    assert.equal(first.response.status, 200);
    assert.equal(remoteCalls, 1);

    offline = true;
    const failed = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/server/search',
      { query: '手动同步' },
    );
    assert.equal(failed.response.status, 200);
    assert.equal(remoteCalls, 2);

    // A second click immediately after the failure must issue another forced
    // conditional request instead of being hidden by the five-minute backoff.
    const retried = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/server/search',
      { query: '手动同步' },
    );
    assert.equal(retried.response.status, 200);
    assert.equal(remoteCalls, 3);
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

async function postJson(baseUrl, token, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

function createGiftSalePublicFixture(root) {
  const publicDir = path.join(root, 'public-fixture');
  const giftDir = path.join(publicDir, 'img', 'bilibili-gifts');
  fs.mkdirSync(giftDir, { recursive: true });
  for (const fileName of [
    'gift-mapping-under-100.md',
    'gift-mapping-100-above.md',
    'silver-free-mapping.md',
  ]) {
    fs.writeFileSync(path.join(giftDir, fileName), '# fixture\n');
  }
  return publicDir;
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function webpBytes() {
  const bytes = Buffer.alloc(16);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(8, 4);
  bytes.write('WEBP', 8, 'ascii');
  return bytes;
}
