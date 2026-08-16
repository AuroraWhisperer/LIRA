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
  parseGiftMappingDocument,
  updateMarkdownAvailability
} = require('../src/bilibili/gift/sale-catalog');

test('collectPanelGiftIds includes panel gifts but excludes the red-packet action', () => {
  const ids = collectPanelGiftIds({
    data: {
      room_gift_list: {
        gold_list: [{ gift_id: 1, upgrade_gift: [{ gift_id: 2 }] }, { gift_id: 13000 }],
        silver_list: [{ id: 3 }]
      },
      tab_list: [{ list: [{ gift_id: 4, upgrade_gift: [{ gift_id: 5 }] }] }],
      discount_gift_list: { list: [{ gift_id: 6 }] }
    }
  });
  assert.deepEqual([...ids].sort((left, right) => left - right), [1, 2, 3, 4, 5, 6]);
});

test('parseGiftConfig and buildGiftCatalog reuse alias images and keep unknown sale IDs', () => {
  const config = parseGiftConfig({ data: { list: [
    { id: 101, name: '主礼物', price: 1000, coin_type: 'gold', webp: 'https://i0.hdslb.com/a.webp' },
    { id: 202, name: '别名礼物', price: 2000, coin_type: 'gold', webp: 'https://i0.hdslb.com/b.webp' }
  ] } });
  const mappings = parseGiftMappingDocument(`
| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 | 同特效代码 |
| ---: | --- | --- | ---: | ---: | --- |
| 101 | [101.webp](0000-under-0100/101.webp) | 主礼物 | 10 | ¥1.00 | 202 |
`);
  const catalog = buildGiftCatalog(new Set([202, 303]), config, mappings);
  assert.deepEqual(catalog, [
    {
      id: '202',
      name: '别名礼物',
      battery: 20,
      rmb: 2,
      imagePath: '/img/bilibili-gifts/0000-under-0100/101.webp'
    },
    {
      id: '303',
      name: '礼物 303',
      battery: 0,
      rmb: 0,
      imagePath: ''
    }
  ]);
});

test('expandBlindBoxSaleIds adds outputs only for sale boxes and prefers non-bag duplicate gifts', () => {
  const config = parseGiftConfig({ data: { list: [
    { id: 10, name: '在售盲盒', price: 5000, bag_gift: 0 },
    { id: 11, name: '重复产物', price: 2000, bag_gift: 1 },
    { id: 12, name: '重复产物', price: 2000, bag_gift: 0 },
    { id: 13, name: '唯一产物', price: 3000, bag_gift: 0 },
    { id: 20, name: '未售盲盒', price: 5000, bag_gift: 0 },
    { id: 21, name: '不应加入', price: 4000, bag_gift: 0 }
  ] } });
  const expanded = expandBlindBoxSaleIds(new Set([10]), config, [
    { name: '在售盲盒', outputs: [{ name: '重复产物', price: 2 }, { name: '唯一产物', price: 3 }] },
    { name: '未售盲盒', outputs: [{ name: '不应加入', price: 4 }] }
  ]);
  assert.deepEqual([...expanded].sort((left, right) => left - right), [10, 12, 13]);
});

test('updateMarkdownAvailability adds one status column and treats aliases as in sale', () => {
  const source = `# gifts

| 礼物 ID | 图片 | 礼物名称 | 电池 | 人民币 | 同特效代码 |
| ---: | --- | --- | ---: | ---: | --- |
| 100 | [100.webp](100.webp) | A | 1 | ¥0.10 | 200 |
| 300 | [300.webp](300.webp) | B | 2 | ¥0.20 |
`;
  const first = updateMarkdownAvailability(source, new Set([200]));
  const second = updateMarkdownAvailability(first, new Set([300]));
  assert.match(first, /\| 100 \|[^\n]+\| 200 \| 在售 \|/);
  assert.match(first, /\| 300 \|[^\n]+\| 非目前在售 \|/);
  assert.match(second, /\| 100 \|[^\n]+\| 200 \| 非目前在售 \|/);
  assert.match(second, /\| 300 \|[^\n]+¥0\.20 \|\s*\| 在售 \|/);
  assert.equal((second.match(/当前在售/g) || []).length, 1);
});

test('gift sale service validates room ID, caches refreshes, persists snapshots, and updates fixed Markdown files', async () => {
  const fixture = createFixture();
  let nowMs = Date.parse('2026-08-16T06:00:00.000Z');
  let roomId = '22637261';
  let fetchCount = 0;
  const service = createGiftSaleCatalogService({
    dataDir: fixture.dataDir,
    publicDir: fixture.publicDir,
    getRoomId: () => roomId,
    getBlindBoxConfig: () => JSON.stringify([
      { name: '测试盲盒', outputs: [{ name: '测试产物', price: 2 }] }
    ]),
    now: () => nowMs,
    minRefreshMs: 10_000,
    async fetchJson(name) {
      fetchCount += 1;
      if (name === 'gift_data') return { code: 0, data: { room_gift_list: { gold_list: [{ gift_id: 100 }] } } };
      return { code: 0, data: { list: [
        { id: 100, name: '测试盲盒', price: 1000, coin_type: 'gold' },
        { id: 101, name: '测试产物', price: 2000, coin_type: 'gold' }
      ] } };
    }
  });

  const refreshed = await service.refresh();
  assert.equal(refreshed.roomId, '22637261');
  assert.equal(refreshed.count, 2);
  assert.equal(refreshed.panelCount, 1);
  assert.deepEqual(refreshed.gifts.map(gift => gift.id), ['100', '101']);
  assert.equal(refreshed.markdownUpdated, true);
  assert.equal(fetchCount, 2);
  assert.match(fs.readFileSync(fixture.mappingPaths[0], 'utf8'), /\| 在售 \|/);
  assert.match(fs.readFileSync(fixture.mappingPaths[1], 'utf8'), /\| 在售 \|/);
  assert.equal(fs.existsSync(path.join(fixture.dataDir, 'overtime-gift-sale.json')), true);

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
    publicDir: path.join(__dirname, '..', 'public'),
    getRoomId: () => '',
    async fetchJson() { called = true; }
  });
  await assert.rejects(service.refresh(), /直播间号/);
  assert.equal(called, false);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-sale-'));
  const dataDir = path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  const giftDir = path.join(publicDir, 'img', 'bilibili-gifts');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(giftDir, '0000-under-0100'), { recursive: true });
  fs.writeFileSync(path.join(giftDir, '0000-under-0100', '100.webp'), 'fixture');
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
    path.join(giftDir, 'silver-free-mapping.md')
  ];
  fs.writeFileSync(mappingPaths[0], gold);
  fs.writeFileSync(mappingPaths[1], gold.replaceAll('100', '101'));
  fs.writeFileSync(mappingPaths[2], silver);
  return { dataDir, publicDir, mappingPaths };
}
