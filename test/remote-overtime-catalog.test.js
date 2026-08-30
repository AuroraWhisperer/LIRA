'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../src/server');

test('uses the remote catalog for local overtime reads and broadcasts changed snapshots', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-overtime-'),
  );
  const giftSalePublicDir = createGiftSalePublicFixture(dataDir);
  let remoteCalls = 0;
  let receivedEtag = '';
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
      },
    });
    const token = runtime.getApiToken();

    const updatePromise = readNextWebSocketMessage(
      app.baseUrl,
      token,
      () => runtime.resumeAuthorizedWork(),
      (message) => message.type === 'gift-catalog:update',
    );
    const update = await updatePromise;
    assert.equal(update.snapshot.source, 'server');
    assert.equal(update.snapshot.version, 'remote-1');
    assert.equal(
      update.snapshot.gifts[0].imagePath,
      'https://api.lirahub.cn/gift-media/images/server.webp',
    );

    const response = await fetch(`${app.baseUrl}/api/overtime/gifts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.source, 'server');
    assert.equal(payload.data.cached, true);
    assert.deepEqual(
      payload.data.gifts.map((gift) => gift.id),
      ['987654321'],
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
            imagePath: 'https://api.lirahub.cn/gift-media/images/server.webp',
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
      'https://api.lirahub.cn/gift-media/images/server.webp',
    );
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('manual catalog sync bypasses the remote backoff after a failed request', async () => {
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
      '/api/overtime/gifts/refresh',
      {},
    );
    assert.equal(first.response.status, 200);
    assert.equal(remoteCalls, 1);

    offline = true;
    const failed = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/refresh',
      {},
    );
    assert.equal(failed.response.status, 400);
    assert.equal(remoteCalls, 2);

    // A second click immediately after the failure must issue another forced
    // conditional request instead of being hidden by the five-minute backoff.
    const retried = await postJson(
      app.baseUrl,
      token,
      '/api/overtime/gifts/refresh',
      {},
    );
    assert.equal(retried.response.status, 400);
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

function readNextWebSocketMessage(baseUrl, token, afterOpen, predicate) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`,
    );
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for remote catalog update.'));
    }, 3000);
    socket.addEventListener('message', async (event) => {
      const message = JSON.parse(String(event.data));
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.close();
      resolve(message);
    });
    socket.addEventListener(
      'open',
      async () => {
        try {
          await afterOpen?.();
        } catch (error) {
          clearTimeout(timeout);
          socket.close();
          reject(error);
        }
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('Remote catalog WebSocket connection failed.'));
      },
      { once: true },
    );
  });
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
