'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../src/server');

test('keeps the current room catalog primary and decorates exact IDs with server artwork', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-overtime-'),
  );
  let remoteCalls = 0;
  let receivedEtag = '';
  const runtime = createServerRuntime({
    dataDir,
    giftSaleGetRoomId: () => '22637261',
    giftSaleGetBlindBoxConfig: () =>
      JSON.stringify([
        {
          name: '当前盲盒',
          outputs: [{ name: '当前盲盒产物', price: 2 }],
        },
      ]),
    giftSaleFetchJson: async (name) => {
      if (name === 'gift_data') {
        return {
          code: 0,
          data: {
            room_gift_list: {
              gold_list: [
                { gift_id: 400 },
                { gift_id: 35793 },
                { gift_id: 35794 },
              ],
            },
          },
        };
      }
      return {
        code: 0,
        data: {
          list: [
            { id: 400, name: '当前盲盒', price: 1000, coin_type: 'gold' },
            {
              id: 401,
              name: '当前盲盒产物',
              price: 2000,
              coin_type: 'gold',
            },
            { id: 35793, name: '同名礼物', price: 3000, coin_type: 'gold' },
            { id: 35794, name: '同名礼物', price: 4000, coin_type: 'gold' },
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
            schemaVersion: 2,
            version: 'remote-1',
            updatedAt: '2026-08-29T08:00:00.000Z',
            stale: false,
            sources: {
              gifts: { asOf: '2026-08-29T08:00:00.000Z', stale: false },
              effects: { asOf: '2026-08-29T08:00:00.000Z', stale: false },
            },
            imageBaseUrl: 'https://api.lirahub.cn',
            etag: '"remote-1"',
            blindBoxes: [
              { giftId: '400', outputGiftIds: ['401'] },
            ],
            gifts: [
              {
                id: '400',
                name: '当前盲盒',
                priceRaw: 1000,
                coinType: 'gold',
                bagGift: false,
                active: true,
                isBlindBox: true,
                imageUrl: '/gift-media/images/box.webp',
              },
              {
                id: '401',
                name: '当前盲盒产物',
                priceRaw: 2000,
                coinType: 'gold',
                bagGift: false,
                active: true,
                isBlindBox: false,
                imageUrl: '/gift-media/images/output.webp',
              },
              {
                id: '35793',
                name: '同名礼物',
                priceRaw: 3000,
                coinType: 'gold',
                bagGift: false,
                active: true,
                isBlindBox: false,
                imageUrl: '/gift-media/images/same-first.webp',
              },
              {
                id: '35794',
                name: '同名礼物',
                priceRaw: 4000,
                coinType: 'gold',
                bagGift: false,
                active: true,
                isBlindBox: false,
                imageUrl: '/gift-media/images/same-second.webp',
              },
              {
                id: '987654321',
                name: '同名礼物',
                priceRaw: 500,
                coinType: 'gold',
                bagGift: false,
                active: true,
                isBlindBox: false,
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
    assert.deepEqual(
      refreshed.payload.data.gifts.map((gift) => [gift.id, gift.imagePath]),
      [
        ['400', '/overtime-gift-images/box.webp'],
        ['401', '/overtime-gift-images/output.webp'],
        ['35793', '/overtime-gift-images/same-first.webp'],
        ['35794', '/overtime-gift-images/same-second.webp'],
      ],
    );
    assert.equal(remoteCalls, 1);

    const cachedSearch = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/local/search',
      { query: '987654321' },
    );
    assert.equal(cachedSearch.response.status, 200);
    assert.deepEqual(cachedSearch.payload.data.gifts.map((gift) => gift.id), [
      '987654321',
    ]);
    assert.equal(remoteCalls, 1);

    const searched = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/server/search',
      { query: '987654321' },
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
            giftName: '同名礼物',
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

test('room refresh keeps its gifts when server artwork is unavailable', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-overtime-offline-'),
  );
  const runtime = createServerRuntime({
    dataDir,
    giftSaleGetRoomId: () => '22637261',
    giftSaleFetchJson: async (name) =>
      name === 'gift_data'
        ? {
            code: 0,
            data: { room_gift_list: { gold_list: [{ gift_id: 35793 }] } },
          }
        : {
            code: 0,
            data: {
              list: [
                {
                  id: 35793,
                  name: '离线仍可用礼物',
                  price: 100,
                  coin_type: 'gold',
                },
              ],
            },
          },
    licenseGate: { isAuthorized: () => true },
  });

  try {
    const app = await runtime.start({
      host: '127.0.0.1',
      startPort: await findAvailablePort(),
      remoteGiftCatalog: {
        imageBaseUrl: 'https://api.lirahub.cn',
        fetch: async () => {
          throw new Error('offline');
        },
        logger: { warn() {}, debug() {} },
      },
    });
    const refreshed = await postJson(
      app.baseUrl,
      runtime.getApiToken(),
      '/api/overtime/gifts/refresh',
      {},
    );

    assert.equal(refreshed.response.status, 200);
    assert.deepEqual(refreshed.payload.data.gifts, [
      {
        id: '35793',
        name: '离线仍可用礼物',
        battery: 1,
        rmb: 0.1,
        imagePath: '',
      },
    ]);
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('local and legacy server searches never fetch while handling the query', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-overtime-force-'),
  );
  let remoteCalls = 0;
  let offline = false;
  const runtime = createServerRuntime({
    dataDir,
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
            schemaVersion: 2,
            version: 'manual-1',
            updatedAt: '2026-08-29T08:00:00.000Z',
            blindBoxes: [],
            gifts: [
              {
                id: '987654322',
                name: '手动同步礼物',
                priceRaw: 100,
                coinType: 'gold',
                active: true,
                isBlindBox: false,
              },
            ],
          };
        },
      },
    });
    const token = runtime.getApiToken();

    await runtime.initializeGiftCatalog({ force: true, reason: 'test' });
    assert.equal(remoteCalls, 1);

    const first = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/local/search',
      { query: '手动同步' },
    );
    assert.equal(first.response.status, 200);
    assert.deepEqual(first.payload.data.gifts.map((gift) => gift.id), [
      '987654322',
    ]);
    assert.equal(remoteCalls, 1);

    offline = true;
    const legacyAlias = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/server/search',
      { query: '手动同步' },
    );
    assert.equal(legacyAlias.response.status, 200);
    assert.deepEqual(legacyAlias.payload.data.gifts.map((gift) => gift.id), [
      '987654322',
    ]);
    assert.equal(remoteCalls, 1);
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
