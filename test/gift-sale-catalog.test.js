'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildGiftCatalog,
  collectPanelGiftIds,
  collectSendableBackpackGiftIds,
  createGiftSaleCatalogService,
  expandBlindBoxSaleIds,
  parseGiftConfig,
  parseGiftMappingDocument,
  searchLocalGiftCatalog,
} = require('../src/bilibili/gift/sale-catalog');

test('collectSendableBackpackGiftIds follows the current backpack without a fixed gift count', () => {
  const nowMs = Date.parse('2026-08-24T08:00:00.000Z');
  const ids = collectSendableBackpackGiftIds(
    {
      data: {
        list: [
          { gift_id: 35777, gift_num: 1, expire_at: 0, bind_roomid: 0 },
          {
            gift_id: 35778,
            gift_num: 2,
            expire_at: Math.floor(nowMs / 1000) + 60,
            bind_roomid: 22637261,
          },
          { gift_id: 40001, gift_num: 3, expire_at: 0, bind_roomid: 0 },
          { gift_id: 31134, gift_num: 0, expire_at: 0, bind_roomid: 0 },
          {
            gift_id: 40002,
            gift_num: 1,
            expire_at: Math.floor(nowMs / 1000) - 1,
            bind_roomid: 0,
          },
          { gift_id: 40003, gift_num: 1, expire_at: 0, bind_roomid: 6 },
        ],
      },
    },
    '22637261',
    nowMs,
  );

  assert.deepEqual(
    [...ids].sort((left, right) => left - right),
    [35777, 35778, 40001],
  );
});

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

test('parseGiftConfig and buildGiftCatalog reuse alias images and keep unknown sale IDs', () => {
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
  const mappings = parseGiftMappingDocument(`
| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 | 同特效代码 |
| ---: | --- | --- | ---: | ---: | --- |
| 101 | [101.webp](0000-under-0100/101.webp) | 主礼物 | 10 | ¥1.00 | 202 |
`);
  const catalog = buildGiftCatalog(
    new Set([202, 303, 34637]),
    config,
    mappings,
  );
  assert.deepEqual(catalog, [
    {
      id: '202',
      name: '别名礼物',
      battery: 20,
      rmb: 2,
      imagePath: '/img/bilibili-gifts/0000-under-0100/101.webp',
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

test('local gift search matches names or IDs and only returns existing mapped images', () => {
  const fixture = createFixture();

  assert.deepEqual(searchLocalGiftCatalog(fixture.publicDir, 'A'), {
    query: 'A',
    count: 1,
    gifts: [
      {
        id: '100',
        name: 'A',
        battery: 10,
        rmb: 1,
        imagePath: '/img/bilibili-gifts/0000-under-0100/100.webp',
      },
    ],
  });
  assert.equal(
    searchLocalGiftCatalog(fixture.publicDir, '100').gifts[0].id,
    '100',
  );
  assert.equal(searchLocalGiftCatalog(fixture.publicDir, '101').count, 0);
  assert.equal(searchLocalGiftCatalog(fixture.publicDir, 'Free').count, 0);
  assert.throws(() => searchLocalGiftCatalog(fixture.publicDir, ''), /1–100/);
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

test('gift sale service validates room ID, caches refreshes, persists snapshots, and leaves Markdown unchanged', async () => {
  const fixture = createFixture();
  const mappingBefore = fixture.mappingPaths.map((filePath) =>
    fs.readFileSync(filePath, 'utf8'),
  );
  let nowMs = Date.parse('2026-08-16T06:00:00.000Z');
  let roomId = '22637261';
  let fetchCount = 0;
  const bagRequestOptions = [];
  const service = createGiftSaleCatalogService({
    dataDir: fixture.dataDir,
    publicDir: fixture.publicDir,
    getRoomId: () => roomId,
    getBlindBoxConfig: () =>
      JSON.stringify([
        { name: '测试盲盒', outputs: [{ name: '测试产物', price: 2 }] },
      ]),
    now: () => nowMs,
    minRefreshMs: 10_000,
    getCookieHeader: async () => 'SESSDATA=fixture',
    async fetchJson(name, _url, _roomId, requestOptions) {
      fetchCount += 1;
      if (name === 'gift_data')
        return {
          code: 0,
          data: { room_gift_list: { gold_list: [{ gift_id: 100 }] } },
        };
      if (name === 'gift_bag') {
        bagRequestOptions.push(requestOptions);
        return {
          code: 0,
          data: {
            list: [
              { gift_id: 35777, gift_num: 1, expire_at: 0, bind_roomid: 0 },
              { gift_id: 31134, gift_num: 0, expire_at: 0, bind_roomid: 0 },
            ],
          },
        };
      }
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
  assert.equal(refreshed.count, 3);
  assert.equal(refreshed.panelCount, 1);
  assert.deepEqual(
    refreshed.gifts.map((gift) => gift.id),
    ['100', '101', '35777'],
  );
  assert.equal(fetchCount, 3);
  assert.deepEqual(bagRequestOptions, [{ cookieHeader: 'SESSDATA=fixture' }]);
  assert.deepEqual(
    fixture.mappingPaths.map((filePath) => fs.readFileSync(filePath, 'utf8')),
    mappingBefore,
  );
  assert.equal(
    fs.existsSync(path.join(fixture.dataDir, 'overtime-gift-sale.json')),
    true,
  );

  const cached = await service.refresh();
  assert.equal(cached.cached, true);
  assert.equal(fetchCount, 3);

  roomId = '6';
  const changedRoom = await service.refresh();
  assert.equal(changedRoom.roomId, '6');
  assert.equal(fetchCount, 6);

  nowMs += 10_001;
  await service.refresh();
  assert.equal(fetchCount, 9);
});

test('gift sale service does not call upstream without a configured room', async () => {
  let called = false;
  const service = createGiftSaleCatalogService({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-sale-empty-')),
    publicDir: path.join(__dirname, '..', 'public'),
    getRoomId: () => '',
    async fetchJson() {
      called = true;
    },
  });
  await assert.rejects(service.refresh(), /直播间号/);
  assert.equal(called, false);
});

test('gift sale service keeps panel-only refreshes working without login and does not infer historical bag gifts', async () => {
  const fixture = createFixture();
  const endpoints = [];
  const service = createGiftSaleCatalogService({
    dataDir: fixture.dataDir,
    publicDir: fixture.publicDir,
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

test('gift sale service removes guard aliases from an existing cached snapshot', () => {
  const fixture = createFixture();
  fs.writeFileSync(
    path.join(fixture.dataDir, 'overtime-gift-sale.json'),
    JSON.stringify({
      roomId: '22637261',
      refreshedAt: '2026-08-16T06:00:00.000Z',
      panelCount: 3,
      gifts: [
        { id: '100', name: '普通礼物', rmb: 1 },
        { id: '34637', name: '舰长一号', rmb: 198 },
        { id: '34638', name: '提督一号', rmb: 1998 },
        { id: '34639', name: '总督一号', rmb: 19998 },
      ],
    }),
  );
  const service = createGiftSaleCatalogService({
    dataDir: fixture.dataDir,
    publicDir: fixture.publicDir,
  });

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.count, 1);
  assert.deepEqual(
    snapshot.gifts.map((gift) => gift.id),
    ['100'],
  );
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-sale-'));
  const dataDir = path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  const giftDir = path.join(publicDir, 'img', 'bilibili-gifts');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(giftDir, '0000-under-0100'), { recursive: true });
  fs.writeFileSync(
    path.join(giftDir, '0000-under-0100', '100.webp'),
    'fixture',
  );
  const gold = `# gifts

| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 | 同特效代码 |
| ---: | --- | --- | ---: | ---: | --- |
| 100 | [100.webp](0000-under-0100/100.webp) | A | 10 | ¥1.00 |
`;
  const silver = `# free

| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 |
| ---: | --- | --- | ---: | ---: |
| 200 | https://i0.hdslb.com/200.webp | Free | 0 | ¥0.00 |
`;
  const mappingPaths = [
    path.join(giftDir, 'gift-mapping-under-100.md'),
    path.join(giftDir, 'gift-mapping-100-above.md'),
    path.join(giftDir, 'silver-free-mapping.md'),
  ];
  fs.writeFileSync(mappingPaths[0], gold);
  fs.writeFileSync(mappingPaths[1], gold.replaceAll('100', '101'));
  fs.writeFileSync(mappingPaths[2], silver);
  return { dataDir, publicDir, mappingPaths };
}
