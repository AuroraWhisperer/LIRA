'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createBlindboxFixture,
  flushBlindboxTasks,
} = require('./helpers/frontend-blindbox-fixture');

test('blind-box catalog events do not depend on the legacy gift registry', async () => {
  const fixture = await createBlindboxFixture();
  fixture.window.AdminApp.gifts = {};
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  fixture.window.AdminApp.eventBus.emit('gift:catalog_updated', {
    snapshot: {
      schemaVersion: 2,
      gifts: [{ id: '100', name: '事件盲盒', rmb: 5, giftCategory: 'blindBox' }],
      blindBoxes: [{ giftId: '100', outputGiftIds: ['101'] }],
    },
  });
  fixture.module.renderBlindBoxList();
  assert.ok(fixture.visibleNames().includes('事件盲盒'));
});

test('blind-box mapping shows room gifts by default and expands the remaining mappings without changing config', async () => {
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

  assert.equal(
    fixture.fetchCalls.filter(({ url }) => url === '/api/overtime/gifts')
      .length,
    0,
  );
  assert.equal(fixture.refreshRequests.length, 1);
  assert.equal(fixture.fetchCalls.at(-1).url, '/api/overtime/gifts/refresh');
  assert.equal(fixture.fetchCalls.at(-1).options.method, 'POST');
  assert.equal(fixture.fetchCalls.at(-1).options.body, '{}');

  const catalogEvents = [];
  fixture.window.AdminApp.eventBus.on('gift:catalog_updated', (data) => {
    catalogEvents.push(data);
  });
  await fixture.resolveRefresh({
    roomId: '123',
    gifts: [{ id: 104 }, { id: '103' }, { id: '200' }],
  });

  const renderedNames = () =>
    [
      ...fixture.container.innerHTML.matchAll(
        /<span class="bb-chip-name">([^<]+)<\/span>/g,
      ),
    ].map(([, name]) => name);
  assert.deepEqual(renderedNames(), [
    '在售官方盒甲',
    '在售官方盒乙',
    '在售自定义盒',
    '官方盲盒',
    '历史官方盒',
    '主播自定义盒',
  ]);
  assert.deepEqual(fixture.visibleNames(), [
    '在售官方盒甲',
    '在售官方盒乙',
    '在售自定义盒',
  ]);
  assert.equal(fixture.listToggle.hidden, false);
  assert.equal(fixture.listToggle.textContent, '展开其余盲盒（3） ▾');
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  renderBlindBoxList();
  assert.deepEqual(fixture.visibleNames(), renderedNames());
  assert.equal(fixture.listToggle.textContent, '收起其余盲盒（3） ▴');
  renderBlindBoxList();
  assert.deepEqual(fixture.visibleNames(), renderedNames());
  fixture.listToggle.setAttribute('aria-expanded', 'false');
  renderBlindBoxList();
  assert.deepEqual(fixture.visibleNames(), [
    '在售官方盒甲',
    '在售官方盒乙',
    '在售自定义盒',
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(catalogEvents)), [
    {
      snapshot: {
        roomId: '123',
        gifts: [{ id: 104 }, { id: '103' }, { id: '200' }],
      },
    },
  ]);
  assert.match(fixture.container.innerHTML, /官方盲盒/);
  assert.match(
    fixture.container.innerHTML,
    /官方产物<small>#101<\/small><small>¥3\.00<\/small>/,
  );
  assert.match(
    fixture.container.innerHTML,
    /<span class="bb-chip-source">官方<\/span>/,
  );
  assert.match(fixture.container.innerHTML, /主播自定义盒/);
  assert.equal(
    (fixture.container.innerHTML.match(/class="chip-delete"/g) || []).length,
    2,
  );
  assert.deepEqual(
    [...fixture.container.innerHTML.matchAll(/data-blind-index="(\d+)"/g)].map(
      ([, index]) => index,
    ),
    ['1', '0'],
  );
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
  assert.equal(renderedNames()[0], '官方盲盒');
  assert.deepEqual(fixture.visibleNames(), ['官方盲盒']);
  assert.equal(fixture.listToggle.textContent, '展开其余盲盒（5） ▾');
  assert.equal(JSON.parse(fixture.textarea.value)[0].name, '主播自定义盒');
});

test('blind-box mapping reports official readiness without legacy migration prompts', async () => {
  const mappingState = {
    mode: 'legacy',
    applied: false,
    customCount: 0,
    migrationPendingCount: 5,
  };
  const fixture = await createBlindboxFixture({ mappingState });
  assert.equal(fixture.status.textContent, '等待服务器应用官方映射');
  Object.assign(mappingState, {
    mode: 'v2',
    applied: true,
    migrationPendingCount: 0,
  });
  fixture.module.renderBlindBoxList();
  assert.equal(fixture.status.textContent, '');
  assert.equal(fixture.status.hidden, true);
  Object.assign(mappingState, { customCount: 2, takenOverCount: 1 });
  fixture.module.renderBlindBoxList();
  assert.equal(
    fixture.status.textContent,
    '自定义 2 项 · 官方已接管 1 项',
  );
  assert.equal(fixture.status.hidden, false);
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
  const excluded = [
    ['31646', '盲盒道具'],
    ['32219', '拆宝盒'],
    ['34580', '测试盲盒'],
    ['34929', '整蛊盲盒(test)'],
    ['35096', '疯五预演'],
    ['35429', '七夕盲盒'],
    ['35429', '中秋盲盒'],
    ['35960', '组合测试'],
  ].map(([id, name]) => ({
    id, name, variantId: `excluded-${id}-${name}`, rmb: 1, giftCategory: 'directGift',
  }));
  const output = { id: '100', variantId: 'output', name: '官方产物', rmb: 3 };
  const snapshot = {
    schemaVersion: 3,
    gifts: [unverified, verified, ...excluded, output],
    blindBoxes: [],
    variantBlindBoxes: [{
      variantId: 'verified',
      outputVariantIds: [],
      awards: [{ name: '舰长3天', valueRmb: 19.8 }],
    }],
  };
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  await fixture.resolveRefresh({ roomId: '123', gifts: snapshot.gifts });
  assert.deepEqual(fixture.visibleNames(), ['大航海盲盒']);
  assert.match(fixture.container.innerHTML, /#34635/);
  assert.doesNotMatch(fixture.container.innerHTML, /#33925/);
  assert.match(fixture.container.innerHTML, /舰长3天<small>¥19\.80<\/small>/);

  // A newly sampled same-name identity cannot inherit another identity's pool.
  snapshot.gifts.push({ ...verified, variantId: 'new-activity', rmb: 60 });
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  assert.deepEqual(fixture.visibleNames(), ['大航海盲盒']);
  assert.equal(fixture.listToggle.hidden, true);

  snapshot.variantBlindBoxes.push({
    variantId: 'unverified',
    outputVariantIds: ['output'],
  });
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  assert.deepEqual(fixture.visibleNames(), ['大航海盲盒', '大航海盲盒']);
  assert.match(fixture.container.innerHTML, /#33925/);
  assert.match(fixture.container.innerHTML, /#34635/);
  assert.match(
    fixture.container.innerHTML,
    /官方产物<small>#100<\/small><small>¥3\.00<\/small>/,
  );

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
    id: '35015', variantId: 'zongxia-verified', name: '粽夏奇趣',
    rmb: 9, giftCategory: 'blindBox',
  };
  const unverified = {
    ...verified, id: '35029', variantId: 'zongxia-unverified',
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
    variantBlindBoxes: [{
      variantId: verified.variantId,
      outputVariantIds: outputs.map((gift) => gift.variantId),
      awards: [],
    }],
  };
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  await fixture.resolveRefresh({ roomId: '123', gifts: [unverified, verified] });
  assert.deepEqual(fixture.visibleNames(), ['粽夏奇趣']);
  assert.equal(fixture.listToggle.hidden, true);

  fixture.listToggle.setAttribute('aria-expanded', 'true');
  fixture.module.applyOfficialCatalogSnapshot(snapshot);
  assert.deepEqual(fixture.visibleNames(), ['粽夏奇趣']);
  assert.match(fixture.container.innerHTML, /#35015/);
  assert.doesNotMatch(fixture.container.innerHTML, /#35029/);
  for (const { id, name } of outputs) {
    assert.ok(fixture.container.innerHTML.includes(
      `${name}<small>#${id}</small><small>¥9.00</small>`,
    ));
  }
});

test('same-name Qixi gifts keep only the verified 25 yuan box in mappings', async () => {
  const fixture = await createBlindboxFixture();
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  fixture.module.applyOfficialCatalogSnapshot({
    schemaVersion: 3,
    gifts: [
      {
        id: '35429', variantId: 'qixi15', name: '七夕盲盒',
        rmb: 15, giftCategory: 'directGift',
      },
      {
        id: '35141', variantId: 'qixi25', name: '七夕盲盒',
        rmb: 25, giftCategory: 'blindBox',
      },
      { id: '35142', variantId: 'qixi-output', name: '七夕产物', rmb: 1 },
    ],
    blindBoxes: [],
    variantBlindBoxes: [{
      variantId: 'qixi25', outputVariantIds: ['qixi-output'],
    }],
  });
  assert.deepEqual(fixture.visibleNames(), ['七夕盲盒']);
  assert.match(fixture.container.innerHTML, /#35141/);
  assert.doesNotMatch(fixture.container.innerHTML, /#35429/);
});

test('blind-box mapping folds historical variants sharing the current gift ID and hides an unnecessary toggle', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123' });
  const current = {
    id: '100',
    variantId: 'current',
    name: '当季盲盒',
    rmb: 10,
    giftCategory: 'blindBox',
  };
  fixture.module.applyOfficialCatalogSnapshot({
    schemaVersion: 3,
    gifts: [
      current,
      { ...current, variantId: 'old', name: '历史盲盒', rmb: 5 },
      { id: '101', variantId: 'output', name: '产物', rmb: 1 },
    ],
    blindBoxes: [],
    variantBlindBoxes: ['current', 'old'].map((variantId) => ({
      variantId,
      outputVariantIds: ['output'],
    })),
  });
  assert.deepEqual(fixture.visibleNames(), []);
  await fixture.resolveRefresh({ roomId: '123', gifts: [current] });
  assert.deepEqual(fixture.visibleNames(), ['当季盲盒']);
  assert.equal(fixture.listToggle.textContent, '展开其余盲盒（1） ▾');

  fixture.module.applyOfficialCatalogSnapshot({
    schemaVersion: 3,
    gifts: [current, { id: '101', variantId: 'output', name: '产物', rmb: 1 }],
    blindBoxes: [],
    variantBlindBoxes: [{ variantId: 'current', outputVariantIds: ['output'] }],
  });
  assert.deepEqual(fixture.visibleNames(), ['当季盲盒']);
  assert.equal(fixture.listToggle.hidden, true);
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
    [
      ...fixture.container.innerHTML.matchAll(
        /<span class="bb-chip-name">([^<]+)<\/span>/g,
      ),
    ].map(([, name]) => name);
  fixture.module.applyOfficialCatalogSnapshot({
    roomId: '123',
    gifts: [{ id: '200' }],
  });
  assert.equal(fixture.refreshRequests.length, 0);
  assert.deepEqual(names(), [
    '官方盲盒',
    '历史官方盒',
    '在售自定义盒',
    '主播自定义盒',
  ]);
  assert.deepEqual(fixture.visibleNames(), []);
  assert.match(fixture.container.innerHTML, /尚未设置直播间/);

  fixture.dispatchSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), [
    '在售自定义盒',
    '官方盲盒',
    '历史官方盒',
    '主播自定义盒',
  ]);

  fixture.dispatchSettings('');
  assert.deepEqual(fixture.visibleNames(), []);
  assert.deepEqual(names(), [
    '官方盲盒',
    '历史官方盒',
    '在售自定义盒',
    '主播自定义盒',
  ]);
  assert.equal(fixture.refreshRequests.length, 0);
  fixture.dispatchSettings('');
  fixture.dispatchAuthChanged();
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSettings('456');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  fixture.dispatchSettings('');
  assert.deepEqual(names(), [
    '官方盲盒',
    '历史官方盒',
    '在售自定义盒',
    '主播自定义盒',
  ]);
  await fixture.resolveRefresh({ roomId: '456', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), [
    '官方盲盒',
    '历史官方盒',
    '在售自定义盒',
    '主播自定义盒',
  ]);
  assert.equal(fixture.refreshRequests.length, 0);
});
