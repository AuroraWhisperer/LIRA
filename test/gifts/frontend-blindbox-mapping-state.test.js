'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBlindboxFixture, flushBlindboxTasks } = require('../helpers/frontend-blindbox-fixture');

test('blind-box mapping shows room gifts by default without changing config', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123' });
  fixture.textarea.value = JSON.stringify([
    {
      giftId: null,
      name: '主播自定义盒',
      price: 5,
      outputs: [{ giftId: '102', name: '自定义产物', price: 2 }],
    },
    { giftId: '200', name: '在售自定义盒', price: 10, outputs: [] },
  ]);
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

  assert.deepEqual(fixture.visibleNames(), ['在售官方盒甲', '在售官方盒乙', '在售自定义盒']);
  assert.equal(JSON.parse(fixture.textarea.value)[0].name, '主播自定义盒');
  renderBlindBoxList();
  assert.equal(JSON.parse(fixture.textarea.value)[0].name, '主播自定义盒');
  fixture.dispatchSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSavedSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '100' }] });
  assert.deepEqual(fixture.visibleNames(), ['官方盲盒']);
  assert.equal(JSON.parse(fixture.textarea.value)[0].name, '主播自定义盒');
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
    { giftId: null, name: '主播自定义盒', price: 5, outputs: [] },
  ]);
  fixture.module.applyOfficialCatalogSnapshot({
    gifts: [
      { id: '100', name: '官方盲盒', rmb: 5, giftCategory: 'blindBox' },
      { id: '101', name: '历史官方盒', rmb: 5, giftCategory: 'blindBox' },
      { id: '102', name: '产物', rmb: 1 },
    ],
    blindBoxes: ['100', '101'].map((giftId) => ({
      giftId,
      outputGiftIds: ['102'],
    })),
  });

  const names = () =>
    [...fixture.container.innerHTML.matchAll(/<span class="bb-chip-name">([^<]+)<\/span>/g)].map(([, name]) => name);
  fixture.module.applyOfficialCatalogSnapshot({
    roomId: '123',
    gifts: [{ id: '200' }],
  });
  assert.equal(fixture.refreshRequests.length, 0);
  assert.deepEqual(names(), ['官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒']);
  assert.deepEqual(fixture.visibleNames(), []);

  fixture.dispatchSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['在售自定义盒', '官方盲盒', '历史官方盒', '主播自定义盒']);

  fixture.dispatchSettings('');
  assert.deepEqual(fixture.visibleNames(), []);
  assert.deepEqual(names(), ['官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒']);
  assert.equal(fixture.refreshRequests.length, 0);
  fixture.dispatchSettings('');
  fixture.dispatchAuthChanged();
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSettings('456');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  fixture.dispatchSettings('');
  assert.deepEqual(names(), ['官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒']);
  await fixture.resolveRefresh({ roomId: '456', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒']);
  assert.equal(fixture.refreshRequests.length, 0);
});
