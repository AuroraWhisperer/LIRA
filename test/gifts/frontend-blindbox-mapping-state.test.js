'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBlindboxFixture, flushBlindboxTasks } = require('../helpers/frontend-blindbox-fixture');

test('a hidden mapping waits for its first viewer and reuses the current room snapshot', async () => {
  const f = await createBlindboxFixture({ roomId: '123', mappingVisible: false,
    cachedSale: { roomId: '123', gifts: [{ id: '200' }] } });
  const saleReads = () => f.fetchCalls.filter(call => ['/api/overtime/gifts', '/api/overtime/gifts/refresh'].includes(call.url));
  assert.equal(saleReads().length, 0);
  f.textarea.value = JSON.stringify([{ giftId: '200', name: '在售盒' }]);
  f.setMappingVisible(true);
  await flushBlindboxTasks();
  assert.deepEqual(f.visibleNames(), ['在售盒']);
  f.setMappingVisible(false);
  f.setMappingVisible(true);
  await flushBlindboxTasks();
  assert.deepEqual(saleReads().map(call => call.url), ['/api/overtime/gifts']);
  let html;
  let reads = 0;
  let writes = 0;
  Object.defineProperty(f.container, 'innerHTML', {
    get() { reads++; return html; }, set(value) { writes++; html = value; },
  });
  f.textarea.value = JSON.stringify([{ giftId: '300', name: '其他盒' }]);
  f.module.renderBlindBoxList();
  assert.deepEqual([reads, writes], [0, 1]);
  assert.match(html, /其他盒/);
});

test('blind-box mapping shows room gifts by default without changing config', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123' });
  const draft = [
    {
      giftId: null,
      name: '主播自定义盒',
      price: 5,
      outputs: [{ giftId: '102', name: '自定义产物', price: 2 }],
    },
    { giftId: '200', name: '在售自定义盒', price: 10, outputs: [] },
  ];
  fixture.textarea.value = JSON.stringify(draft);
  const snapshot = {
    schemaVersion: 2,
    source: 'server',
    roomId: '',
    gifts: [
      { id: '100', name: '官方盲盒', rmb: 5, giftCategory: 'blindBox', active: true },
      { id: '101', name: '官方产物', rmb: 3, giftCategory: 'directGift' },
      { id: '103', name: '在售官方盒甲', rmb: 5, giftCategory: 'blindBox' },
      {
        id: '102',
        name: '历史官方盒',
        rmb: 5,
        giftCategory: 'blindBox',
        active: false,
      },
      { id: '104', name: '在售官方盒乙', rmb: 10, giftCategory: 'blindBox' },
    ],
    blindBoxes: ['100', '102', '103', '104'].map((giftId) => ({
      giftId,
      outputGiftIds: ['101'],
    })),
  };
  const { applyOfficialCatalogSnapshot, renderBlindBoxList } = fixture.module;
  applyOfficialCatalogSnapshot(snapshot);

  assert.equal(fixture.refreshRequests.length, 1);
  assert.equal(fixture.fetchCalls.at(-1).url, '/api/overtime/gifts/refresh');
  assert.equal(fixture.fetchCalls.at(-1).options.method, 'POST');

  await fixture.resolveRefresh({
    roomId: '123',
    gifts: [{ id: 104 }, { id: '103' }, { id: '200' }],
  });

  const onSale = ['在售官方盒甲', '在售官方盒乙', '在售自定义盒'];
  assert.deepEqual(fixture.visibleNames(), onSale);
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  renderBlindBoxList();
  const expanded = fixture.visibleNames();
  assert.deepEqual(expanded.slice(0, onSale.length), onSale);
  assert.ok(expanded.includes('主播自定义盒'));
  fixture.listToggle.setAttribute('aria-expanded', 'false');
  fixture.dispatchSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSavedSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '100' }] });
  assert.deepEqual(fixture.visibleNames(), ['官方盲盒']);
  assert.deepEqual(JSON.parse(fixture.textarea.value), draft);
});

test('official mapping requires a verified pool for each identity and respects non-box labels on refresh', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123' });
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  const unverified = {
    id: '33925',
    variantId: 'unverified',
    name: '大航海盲盒',
    rmb: 50,
    giftCategory: 'blindBox',
  };
  const verified = { ...unverified, id: '34635', variantId: 'verified' };
  const directGift = {
    id: '35429', name: '七夕盲盒', variantId: 'direct-gift', rmb: 15, giftCategory: 'directGift',
  };
  const output = { id: '100', variantId: 'output', name: '官方产物', rmb: 3 };
  const snapshot = {
    schemaVersion: 3,
    gifts: [unverified, verified, directGift, output],
    blindBoxes: [],
    variantBlindBoxes: [
      {
        variantId: 'verified',
        outputVariantIds: [],
        awards: [{ name: '舰长3天', valueRmb: 19.8 }],
      },
    ],
  };
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  await fixture.resolveRefresh({ roomId: '123', gifts: snapshot.gifts });
  assert.deepEqual(fixture.visibleNames(), ['大航海盲盒']);
  assert.match(fixture.container.innerHTML, /#34635/);
  assert.doesNotMatch(fixture.container.innerHTML, /#33925/);

  // A newly sampled same-name identity cannot inherit another identity's pool.
  snapshot.gifts.push({ ...verified, variantId: 'new-activity', rmb: 60 });
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  assert.deepEqual(fixture.visibleNames(), ['大航海盲盒']);

  snapshot.variantBlindBoxes.push({
    variantId: 'unverified',
    outputVariantIds: ['output'],
  });
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  assert.deepEqual(fixture.visibleNames(), ['大航海盲盒', '大航海盲盒']);
  assert.match(fixture.container.innerHTML, /#33925/);
  assert.match(fixture.container.innerHTML, /#34635/);

  verified.giftCategory = 'directGift';
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  assert.deepEqual(fixture.visibleNames(), ['大航海盲盒']);
  assert.doesNotMatch(fixture.container.innerHTML, /#34635|舰长3天/);
});

test('legacy official mapping also excludes boxes without a verified output pool', async () => {
  const fixture = await createBlindboxFixture();
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  fixture.module.applyOfficialCatalogSnapshot({
    schemaVersion: 2,
    gifts: [
      { id: '100', name: '同名盲盒', rmb: 5, giftCategory: 'blindBox' },
      { id: '101', name: '同名盲盒', rmb: 5, giftCategory: 'blindBox' },
      { id: '102', name: '产物', rmb: 1, giftCategory: 'directGift' },
    ],
    blindBoxes: [{ giftId: '101', outputGiftIds: ['102'] }],
  });
  assert.deepEqual(fixture.visibleNames(), ['同名盲盒']);
  assert.match(fixture.container.innerHTML, /#101/);
  assert.doesNotMatch(fixture.container.innerHTML, /#100/);
});

test('same-name Zongxia boxes keep the verified box and all seven outputs after refresh', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123' });
  const verified = {
    id: '35015',
    variantId: 'zongxia-verified',
    name: '粽夏奇趣',
    rmb: 9,
    giftCategory: 'blindBox',
  };
  const unverified = {
    ...verified,
    id: '35029',
    variantId: 'zongxia-unverified',
  };
  const outputs = [
    ['35026', '快乐星球'],
    ['35020', '快乐时光'],
    ['35021', '鲜花小车'],
    ['35024', '青白灵韵'],
    ['35022', '五彩缘结'],
    ['35025', '旋转木马'],
    ['35023', '云渊溯龙'],
  ].map(([id, name]) => ({ id, name, variantId: `output-${id}`, rmb: 9 }));
  const snapshot = {
    schemaVersion: 3,
    gifts: [unverified, verified, ...outputs],
    blindBoxes: [],
    variantBlindBoxes: [
      {
        variantId: verified.variantId,
        outputVariantIds: outputs.map((gift) => gift.variantId),
        awards: [],
      },
    ],
  };
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  await fixture.resolveRefresh({ roomId: '123', gifts: [unverified, verified] });
  assert.deepEqual(fixture.visibleNames(), ['粽夏奇趣']);

  fixture.listToggle.setAttribute('aria-expanded', 'true');
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  assert.deepEqual(fixture.visibleNames(), ['粽夏奇趣']);
  assert.match(fixture.container.innerHTML, /#35015/);
  assert.doesNotMatch(fixture.container.innerHTML, /#35029/);
  for (const { id } of outputs) assert.ok(fixture.container.innerHTML.includes(`#${id}<`), id);
});

test('blind-box mapping refreshes when a room is configured without a desktop auth bridge and ignores a cleared room', async () => {
  const fixture = await createBlindboxFixture({ authAvailable: false });
  fixture.textarea.value = JSON.stringify([
    { giftId: '200', name: '在售自定义盒', price: 10, outputs: [] },
  ]);
  fixture.module.applyOfficialCatalogSnapshot({
    gifts: [
      { id: '100', name: '官方盲盒', rmb: 5, giftCategory: 'blindBox' },
      { id: '102', name: '产物', rmb: 1 },
    ],
    blindBoxes: [{ giftId: '100', outputGiftIds: ['102'] }],
  });

  fixture.module.applyOfficialCatalogSnapshot({
    roomId: '123',
    gifts: [{ id: '200' }],
  });
  assert.equal(fixture.refreshRequests.length, 0);
  assert.deepEqual(fixture.visibleNames(), []);

  fixture.dispatchSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '200' }] });
  assert.deepEqual(fixture.visibleNames(), ['在售自定义盒']);

  fixture.dispatchSettings('');
  assert.deepEqual(fixture.visibleNames(), []);
  fixture.dispatchSettings('');
  fixture.dispatchAuthChanged();
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSettings('456');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  fixture.dispatchSettings('');
  await fixture.resolveRefresh({ roomId: '456', gifts: [{ id: '200' }] });
  assert.deepEqual(fixture.visibleNames(), []);
  assert.equal(fixture.refreshRequests.length, 0);
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  fixture.module.renderBlindBoxList();
  assert.deepEqual(new Set(fixture.visibleNames()), new Set(['官方盲盒', '在售自定义盒']));
});
