'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../src/server');

test('overtime API requires auth, validates commands, extends snapshots, and broadcasts updates', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-overtime-routes-'));
  const giftSalePublicDir = createGiftSalePublicFixture(dataDir);
  const runtime = createServerRuntime({
    dataDir,
    giftSalePublicDir,
    giftSaleGetRoomId: () => '22637261',
    giftSaleFetchJson: async (name, _url, _roomId, requestOptions) => {
      if (name === 'gift_data') {
        return { code: 0, data: { room_gift_list: { gold_list: [{ gift_id: 35793 }] } } };
      }
      if (name === 'gift_bag') {
        assert.deepEqual(requestOptions, { cookieHeader: 'SESSDATA=fixture' });
        return { code: 0, data: { list: [
          { gift_id: 35794, gift_num: 1, expire_at: 0, bind_roomid: 0 }
        ] } };
      }
      return { code: 0, data: { list: [
        { id: 35793, name: '传情鹊', price: 100, coin_type: 'gold' },
        { id: 35794, name: '未来背包礼物', price: 200, coin_type: 'gold', bag_gift: 1 }
      ] } };
    }
  });

  try {
    const app = await runtime.start({
      host: '127.0.0.1',
      startPort: await findAvailablePort(),
      bilibiliAuth: {
        getAuthState: async () => ({ loggedIn: true, uid: 1 }),
        getCookieHeader: async () => 'SESSDATA=fixture',
        getUid: async () => 1
      }
    });
    const token = runtime.getApiToken();

    const unauthorized = await fetch(`${app.baseUrl}/api/overtime`);
    assert.equal(unauthorized.status, 401);

    const initial = await requestJson(app.baseUrl, token, '/api/overtime');
    assert.equal(initial.enabled, false);
    assert.equal(initial.pendingCount, 0);
    assert.deepEqual(initial.settlements, []);

    const initialCatalog = await requestJson(app.baseUrl, token, '/api/overtime/gifts');
    assert.equal(initialCatalog.count, 0);

    const refreshedCatalog = await postJson(app.baseUrl, token, '/api/overtime/gifts/refresh', {});
    assert.equal(refreshedCatalog.response.status, 200);
    assert.equal(refreshedCatalog.payload.data.count, 2);
    assert.deepEqual(refreshedCatalog.payload.data.gifts.map(gift => gift.id), ['35793', '35794']);
    assert.equal(refreshedCatalog.payload.data.gifts[0].imagePath, '/img/bilibili-gifts/0000-under-0100/35793.webp');

    const localSearch = await postJson(app.baseUrl, token, '/api/overtime/gifts/local/search', { query: '万象' });
    assert.equal(localSearch.response.status, 200);
    assert.deepEqual(localSearch.payload.data.gifts, [{
      id: '35600',
      name: '万象天衣',
      battery: 30000,
      rmb: 3000,
      imagePath: '/img/bilibili-gifts/3000-above/35600.webp'
    }]);
    const invalidLocalSearch = await postJson(app.baseUrl, token, '/api/overtime/gifts/local/search', { query: '' });
    assert.equal(invalidLocalSearch.response.status, 400);

    const manualLocalRule = await postJson(app.baseUrl, token, '/api/overtime/rules', {
      rules: [{
        giftId: '35600',
        giftName: '万象天衣',
        imagePath: '/img/bilibili-gifts/3000-above/35600.webp',
        mode: 'fixed',
        fixedSeconds: 60,
        quantityMode: 'item'
      }]
    });
    assert.equal(manualLocalRule.response.status, 200);
    assert.equal(manualLocalRule.payload.data.rules[0].giftId, '35600');

    const snapshotMessage = await readNextWebSocketMessage(app.baseUrl, token);
    assert.equal(snapshotMessage.type, 'snapshot');
    assert.equal(snapshotMessage.state.overtime.status, 'disabled');
    assert.equal(snapshotMessage.state.giftDetection.consumers.overtime, false);

    const invalid = await postJson(app.baseUrl, token, '/api/overtime/action', { action: 'launch' });
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.payload.error, /action/);

    const updatePromise = readNextWebSocketMessage(app.baseUrl, token, async () => {
      const enabled = await postJson(app.baseUrl, token, '/api/overtime/action', { action: 'enable' });
      assert.equal(enabled.response.status, 200);
      assert.equal(enabled.payload.data.enabled, true);
    }, message => message.type === 'overtime:update');
    const update = await updatePromise;
    assert.equal(update.reason, 'manual');
    assert.equal(update.state.enabled, true);
    assert.equal(update.state.revision > 0, true);

    const configured = await postJson(app.baseUrl, token, '/api/overtime/time', {
      initialSeconds: 600,
      remainingSeconds: 300
    });
    assert.equal(configured.response.status, 200);
    assert.equal(configured.payload.data.effectiveRemainingMs, 300_000);

    const invalidQuantityMode = await postJson(app.baseUrl, token, '/api/overtime/rules', {
      rules: [{ giftId: '35793', mode: 'fixed', fixedSeconds: 60, quantityMode: 'price' }]
    });
    assert.equal(invalidQuantityMode.response.status, 400);
    assert.match(invalidQuantityMode.payload.error, /quantityMode/);

    const savedRules = await postJson(app.baseUrl, token, '/api/overtime/rules', {
      rules: [{ giftId: '35793', mode: 'fixed', fixedSeconds: 60, quantityMode: 'item' }]
    });
    assert.equal(savedRules.response.status, 200);
    assert.equal(savedRules.payload.data.rules[0].quantityMode, 'item');

    const savedDisplayRule = await postJson(app.baseUrl, token, '/api/overtime/rules', {
      rules: [{ giftId: '35793', mode: 'display', displayText: '谢谢支持', quantityMode: 'group' }]
    });
    assert.equal(savedDisplayRule.response.status, 200);
    assert.equal(savedDisplayRule.payload.data.rules[0].displayText, '谢谢支持');
    assert.equal(savedDisplayRule.payload.data.rules[0].mode, 'display');

    const invalidDisplayRule = await postJson(app.baseUrl, token, '/api/overtime/rules', {
      rules: [{ giftId: '35793', mode: 'display', displayText: '七个文字超长度' }]
    });
    assert.equal(invalidDisplayRule.response.status, 400);
    assert.match(invalidDisplayRule.payload.error, /displayText/);

    const malicious = await postJson(app.baseUrl, token, '/api/overtime/config', {
      path: '../secret.png',
      fit: 'cover'
    });
    assert.equal(malicious.response.status, 400);
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function createGiftSalePublicFixture(root) {
  const publicDir = path.join(root, 'public-fixture');
  const giftDir = path.join(publicDir, 'img', 'bilibili-gifts');
  fs.mkdirSync(path.join(giftDir, '0000-under-0100'), { recursive: true });
  fs.mkdirSync(path.join(giftDir, '3000-above'), { recursive: true });
  fs.writeFileSync(path.join(giftDir, '0000-under-0100', '35793.webp'), 'fixture');
  fs.writeFileSync(path.join(giftDir, '3000-above', '35600.webp'), 'fixture');
  const gold = `# gifts

| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 | 同特效代码 |
| ---: | --- | --- | ---: | ---: | --- |
| 35793 | [35793.webp](0000-under-0100/35793.webp) | 传情鹊 | 1 | ¥0.10 |
| 35600 | [35600.webp](3000-above/35600.webp) | 万象天衣 | 30000 | ¥3000.00 |
`;
  const silver = `# free

| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 |
| ---: | --- | --- | ---: | ---: |
| 13000 | https://i0.hdslb.com/free.webp | 发红包 | 0 | ¥0.00 |
`;
  fs.writeFileSync(path.join(giftDir, 'gift-mapping-under-100.md'), gold);
  fs.writeFileSync(path.join(giftDir, 'gift-mapping-100-above.md'), gold);
  fs.writeFileSync(path.join(giftDir, 'silver-free-mapping.md'), silver);
  return publicDir;
}

async function requestJson(baseUrl, token, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error || pathname);
  return payload.data;
}

async function postJson(baseUrl, token, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function readNextWebSocketMessage(baseUrl, token, afterOpen, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`
    );
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for overtime WebSocket message.'));
    }, 2000);
    socket.addEventListener('message', async (event) => {
      const message = JSON.parse(String(event.data));
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.close();
      resolve(message);
    });
    socket.addEventListener('open', async () => {
      if (!afterOpen) return;
      try {
        await afterOpen();
      } catch (error) {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      }
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Overtime WebSocket connection failed.'));
    }, { once: true });
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
