'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildGiftCatalog,
  collectPanelGiftIds,
  createGiftSaleCatalogService,
  expandBlindBoxSaleIds,
  parseGiftConfig,
} = require('../src/bilibili/gift/sale-catalog');

test('collectPanelGiftIds excludes red-packet and guard purchase actions', () => {
  const ids = collectPanelGiftIds({
    data: {
      room_gift_list: {
        gold_list: [
          { gift_id: 1, upgrade_gift: [{ gift_id: 2 }] },
          { gift_id: 13000 },
          { gift_id: 34637 },
          { gift_id: 34638 },
          { gift_id: 34639 },
        ],
        silver_list: [{ id: 3 }],
      },
      tab_list: [{ list: [{ gift_id: 4, upgrade_gift: [{ gift_id: 5 }] }] }],
      discount_gift_list: { list: [{ gift_id: 6 }] },
    },
  });
  assert.deepEqual(
    [...ids].sort((left, right) => left - right),
    [1, 2, 3, 4, 5, 6],
  );
});

test('parseGiftConfig and buildGiftCatalog keep unknown sale IDs without local artwork', () => {
  const config = parseGiftConfig({
    data: {
      list: [
        {
          id: 101,
          name: '主礼物',
          price: 1000,
          coin_type: 'gold',
          webp: 'https://i0.hdslb.com/a.webp',
        },
        {
          id: 202,
          name: '别名礼物',
          price: 2000,
          coin_type: 'gold',
          webp: 'https://i0.hdslb.com/b.webp',
        },
      ],
    },
  });
  const catalog = buildGiftCatalog(
    new Set([202, 303, 34637]),
    config,
  );
  assert.deepEqual(catalog, [
    {
      id: '202',
      name: '别名礼物',
      battery: 20,
      rmb: 2,
      imagePath: '',
    },
    {
      id: '303',
      name: '礼物 303',
      battery: 0,
      rmb: 0,
      imagePath: '',
    },
  ]);
});

test('expandBlindBoxSaleIds adds outputs only for sale boxes and prefers non-bag duplicate gifts', () => {
  const config = parseGiftConfig({
    data: {
      list: [
        { id: 10, name: '在售盲盒', price: 5000, bag_gift: 0 },
        { id: 11, name: '重复产物', price: 2000, bag_gift: 1 },
        { id: 12, name: '重复产物', price: 2000, bag_gift: 0 },
        { id: 13, name: '唯一产物', price: 3000, bag_gift: 0 },
        { id: 20, name: '未售盲盒', price: 5000, bag_gift: 0 },
        { id: 21, name: '不应加入', price: 4000, bag_gift: 0 },
      ],
    },
  });
  const expanded = expandBlindBoxSaleIds(new Set([10]), config, [
    {
      name: '在售盲盒',
      outputs: [
        { name: '重复产物', price: 2 },
        { name: '唯一产物', price: 3 },
      ],
    },
    { name: '未售盲盒', outputs: [{ name: '不应加入', price: 4 }] },
  ]);
  assert.deepEqual(
    [...expanded].sort((left, right) => left - right),
    [10, 12, 13],
  );
});

test('expandBlindBoxSaleIds distinguishes same-name gifts by configured price', () => {
  const config = parseGiftConfig({
    data: {
      list: [
        { id: 31134, name: '守护之翼', price: 200000, bag_gift: 1 },
        { id: 35461, name: '羁绊宝盒', price: 33000, bag_gift: 0 },
        { id: 35465, name: '守护之翼', price: 100000, bag_gift: 0 },
      ],
    },
  });
  const expanded = expandBlindBoxSaleIds(new Set([35461]), config, [
    { name: '羁绊宝盒', outputs: [{ name: '守护之翼', price: 100 }] },
  ]);

  assert.deepEqual(
    [...expanded].sort((left, right) => left - right),
    [35461, 35465],
  );
});

test('gift sale service validates room ID, caches refreshes, persists snapshots, and needs no public assets', async () => {
  const fixture = createFixture();
  let nowMs = Date.parse('2026-08-16T06:00:00.000Z');
  let roomId = '22637261';
  let fetchCount = 0;
  const service = createGiftSaleCatalogService({
    dataDir: fixture.dataDir,
    getRoomId: () => roomId,
    getBlindBoxConfig: () =>
      JSON.stringify([
        { name: '测试盲盒', outputs: [{ name: '测试产物', price: 2 }] },
      ]),
    now: () => nowMs,
    minRefreshMs: 10_000,
    async fetchJson(name) {
      fetchCount += 1;
      if (name === 'gift_data')
        return {
          code: 0,
          data: { room_gift_list: { gold_list: [{ gift_id: 100 }] } },
        };
      return {
        code: 0,
        data: {
          list: [
            { id: 100, name: '测试盲盒', price: 1000, coin_type: 'gold' },
            { id: 101, name: '测试产物', price: 2000, coin_type: 'gold' },
            {
              id: 35777,
              name: '相识玉扣',
              price: 35000,
              coin_type: 'gold',
              bag_gift: 1,
            },
            {
              id: 31134,
              name: '旧背包礼物',
              price: 200000,
              coin_type: 'gold',
              bag_gift: 1,
            },
          ],
        },
      };
    },
  });

  const refreshed = await service.refresh();
  assert.equal(refreshed.roomId, '22637261');
  assert.equal(refreshed.count, 2);
  assert.equal(refreshed.panelCount, 1);
  assert.deepEqual(
    refreshed.gifts.map((gift) => gift.id),
    ['100', '101'],
  );
  assert.equal(fetchCount, 2);
  assert.deepEqual(
    refreshed.gifts.map((gift) => gift.imagePath),
    ['', ''],
  );
  assert.equal(
    fs.existsSync(path.join(fixture.dataDir, 'overtime-gift-sale.json')),
    true,
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(fixture.dataDir, 'overtime-gift-sale.json'),
        'utf8',
      ),
    ).schemaVersion,
    1,
  );
  const reloaded = createGiftSaleCatalogService({ dataDir: fixture.dataDir });
  assert.deepEqual(
    reloaded.getSnapshot().gifts.map((gift) => gift.id),
    ['100', '101'],
  );

  const cached = await service.refresh();
  assert.equal(cached.cached, true);
  assert.equal(fetchCount, 2);

  roomId = '6';
  const changedRoom = await service.refresh();
  assert.equal(changedRoom.roomId, '6');
  assert.equal(fetchCount, 4);

  nowMs += 10_001;
  await service.refresh();
  assert.equal(fetchCount, 6);
});

test('gift sale service does not call upstream without a configured room', async () => {
  let called = false;
  const service = createGiftSaleCatalogService({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-sale-empty-')),
    getRoomId: () => '',
    async fetchJson() {
      called = true;
    },
  });
  await assert.rejects(service.refresh(), /直播间号/);
  assert.equal(called, false);
});

test('gift sale service requests only room panel/config and does not infer historical bag gifts', async () => {
  const fixture = createFixture();
  const endpoints = [];
  const service = createGiftSaleCatalogService({
    dataDir: fixture.dataDir,
    getRoomId: () => '22637261',
    async fetchJson(name) {
      endpoints.push(name);
      if (name === 'gift_data') {
        return {
          code: 0,
          data: { room_gift_list: { gold_list: [{ gift_id: 100 }] } },
        };
      }
      return {
        code: 0,
        data: {
          list: [
            { id: 100, name: '面板礼物', price: 1000, coin_type: 'gold' },
            {
              id: 35600,
              name: '历史背包礼物',
              price: 3000000,
              coin_type: 'gold',
              bag_gift: 1,
            },
          ],
        },
      };
    },
  });

  const refreshed = await service.refresh();
  assert.deepEqual(endpoints, ['gift_data', 'gift_config']);
  assert.deepEqual(
    refreshed.gifts.map((gift) => gift.id),
    ['100'],
  );
});

test('gift sale service ignores legacy snapshots that may contain backpack gifts', () => {
  const fixture = createFixture();
  fs.writeFileSync(
    path.join(fixture.dataDir, 'overtime-gift-sale.json'),
    JSON.stringify({
      roomId: '22637261',
      refreshedAt: '2026-08-16T06:00:00.000Z',
      panelCount: 3,
      gifts: [
        {
          id: '100',
          name: '普通礼物',
          rmb: 1,
          imagePath: '/img/bilibili-gifts/0000-under-0100/100.webp',
        },
        { id: '34637', name: '舰长一号', rmb: 198 },
        { id: '34638', name: '提督一号', rmb: 1998 },
        { id: '34639', name: '总督一号', rmb: 19998 },
      ],
    }),
  );
  const service = createGiftSaleCatalogService({
    dataDir: fixture.dataDir,
  });

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.count, 0);
  assert.deepEqual(snapshot.gifts, []);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-sale-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return { dataDir };
}
