'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createBlindboxFixture,
  flushBlindboxTasks,
} = require('./helpers/frontend-blindbox-fixture');

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
      { id: '100', name: '官方盲盒', rmb: 5, isBlindBox: true, active: true },
      { id: '101', name: '官方产物', rmb: 3, isBlindBox: false },
      { id: '103', name: '在售官方盒甲', rmb: 5, isBlindBox: true },
      {
        id: '102',
        name: '历史官方盒',
        rmb: 5,
        isBlindBox: true,
        active: false,
      },
      { id: '104', name: '在售官方盒乙', rmb: 10, isBlindBox: true },
    ],
    blindBoxes: [{ giftId: '100', outputGiftIds: ['101'] }],
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
    /官方产物<small>#101<\/small><small>3<\/small>/,
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
  assert.equal(fixture.status.textContent, '官方映射已启用');
  Object.assign(mappingState, { customCount: 2, takenOverCount: 1 });
  fixture.module.renderBlindBoxList();
  assert.equal(
    fixture.status.textContent,
    '官方映射已启用 · 自定义 2 项 · 官方已接管 1 项',
  );
});

test('blind-box mapping folds historical variants sharing the current gift ID and hides an unnecessary toggle', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123' });
  const current = {
    id: '100',
    variantId: 'current',
    name: '当季盲盒',
    rmb: 10,
    isBlindBox: true,
  };
  fixture.module.applyOfficialCatalogSnapshot({
    schemaVersion: 3,
    gifts: [
      current,
      { ...current, variantId: 'old', name: '历史盲盒', rmb: 5 },
    ],
    blindBoxes: [],
    variantBlindBoxes: [],
  });
  assert.deepEqual(fixture.visibleNames(), []);
  await fixture.resolveRefresh({ roomId: '123', gifts: [current] });
  assert.deepEqual(fixture.visibleNames(), ['当季盲盒']);
  assert.equal(fixture.listToggle.textContent, '展开其余盲盒（1） ▾');

  fixture.module.applyOfficialCatalogSnapshot({
    schemaVersion: 3,
    gifts: [current],
    blindBoxes: [],
    variantBlindBoxes: [],
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
      { id: '100', name: '官方盲盒', rmb: 5, isBlindBox: true },
      { id: '101', name: '历史官方盒', rmb: 5, isBlindBox: true },
    ],
    blindBoxes: [],
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
