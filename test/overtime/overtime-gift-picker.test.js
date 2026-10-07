'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, createGifts, deferred, flush, nodeText, openPicker, optionNodes } = require('../helpers/overtime-gift-picker-fixture');

test('blank global activation renders the full local catalog and filters in place', async () => {
  const globalGifts = createGifts(3000);
  globalGifts[2999].name = '星光礼物 Gift 2999';
  const fixture = await createFixture({
    globalGifts,
    saleGifts: [globalGifts[0], globalGifts[1]],
    selectedGiftIds: [globalGifts[0].id],
  });

  await openPicker(fixture);
  assert.equal(optionNodes(fixture).length, 4);

  await fixture.elements.globalSearchButton.dispatchEvent('click');

  assert.equal(fixture.state.fetchCalls.length, 1);
  assert.equal(fixture.state.fetchCalls[0].url, '/api/overtime/gifts/catalog');
  assert.equal(fixture.state.fetchCalls[0].options?.method || 'GET', 'GET');
  assert.equal(fixture.state.fetchCalls[0].options?.body, undefined);
  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  assert.equal(optionNodes(fixture).length, 2999);
  assert.equal(fixture.elements.results.children[0].textContent, '礼物库 · 2999 / 3000 个');
  assert.doesNotMatch(nodeText(fixture.elements.results), /本地礼物库|目录中|当前未在售|目录外/);
  assert.equal(
    optionNodes(fixture).some((node) => nodeText(node).includes('Gift 0000')),
    false,
  );
  const image = fixture.elements.results.querySelector('img');
  assert.equal(image.loading, 'lazy');
  assert.equal(image.decoding, 'async');

  fixture.elements.search.value = 'gift-2999';
  await fixture.elements.search.dispatchEvent('input');
  assert.equal(optionNodes(fixture).length, 1);
  assert.match(nodeText(optionNodes(fixture)[0]), /Gift 2999/);

  for (const query of ['星光', 'gIfT 2999']) {
    fixture.elements.search.value = query;
    await fixture.elements.search.dispatchEvent('input');
    assert.equal(optionNodes(fixture).length, 1);
    assert.match(nodeText(optionNodes(fixture)[0]), /Gift 2999/);
  }

  fixture.elements.search.value = '';
  await fixture.elements.search.dispatchEvent('input');
  assert.equal(optionNodes(fixture).length, 2999);

  fixture.elements.search.value = 'gift-2998';
  const requestCount = fixture.state.fetchCalls.length;
  const globalEnter = await fixture.elements.search.dispatchEvent('keydown', {
    key: 'Enter',
  });
  assert.equal(globalEnter.defaultPrevented, true);
  assert.equal(fixture.elements.picker.open, true);
  assert.equal(fixture.state.fetchCalls.length, requestCount);
  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  assert.equal(optionNodes(fixture).length, 1);

  fixture.elements.search.value = '';
  await fixture.elements.globalSearchButton.dispatchEvent('click');
  assert.equal(fixture.elements.globalSearchButton.textContent, '搜索全部礼物');
  assert.equal(optionNodes(fixture).length, 4);

  fixture.elements.search.value = 'guard';
  await fixture.elements.search.dispatchEvent('input');
  const saleRequestCount = fixture.state.fetchCalls.length;
  const saleEnter = await fixture.elements.search.dispatchEvent('keydown', {
    key: 'Enter',
  });
  assert.equal(saleEnter.defaultPrevented, true);
  assert.equal(fixture.elements.picker.open, true);
  assert.equal(fixture.state.fetchCalls.length, saleRequestCount);
  assert.equal(optionNodes(fixture).length, 3);

  await fixture.elements.globalSearchButton.dispatchEvent('click');
  fixture.elements.search.value = 'does-not-exist';
  await fixture.elements.search.dispatchEvent('input');
  assert.match(nodeText(fixture.elements.results), /全部礼物中没有匹配项/);
});

test('global picker distinguishes an unavailable cache from a valid empty cache', async () => {
  for (const scenario of [
    {
      fetchPayload: { ok: true, data: null },
      expected: /礼物库尚未缓存|读取礼物库失败/,
    },
    {
      fetchPayload: { ok: true, data: { gifts: [] } },
      expected: /礼物库暂无礼物/,
    },
  ]) {
    const fixture = await createFixture(scenario);
    await openPicker(fixture);
    await fixture.elements.globalSearchButton.dispatchEvent('click');
    assert.match(nodeText(fixture.elements.results), scenario.expected);
    assert.doesNotMatch(nodeText(fixture.elements.results), /本地礼物库/);
    assert.equal(fixture.elements.globalSearchButton.disabled, false);
    assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  }
});

test('global picker shows fetch failures and can return to sale gifts', async () => {
  const fixture = await createFixture({
    fetchImpl: async () => {
      throw new Error('catalog unavailable');
    },
  });
  await openPicker(fixture);
  await fixture.elements.globalSearchButton.dispatchEvent('click');

  assert.match(nodeText(fixture.elements.results), /catalog unavailable/);
  assert.equal(fixture.elements.globalSearchButton.disabled, false);
  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');

  await fixture.elements.globalSearchButton.dispatchEvent('click');
  assert.equal(fixture.elements.globalSearchButton.textContent, '搜索全部礼物');
  assert.ok(optionNodes(fixture).length > 0);
});

test('off-sale global gifts remain selectable and are added through the rule editor', async () => {
  const saleGifts = createGifts(1);
  const globalGifts = [...saleGifts, { id: 'gift-off-sale', name: 'Off Sale', rmb: 2 }];
  const fixture = await createFixture({ globalGifts, saleGifts });
  await openPicker(fixture);
  await fixture.elements.globalSearchButton.dispatchEvent('click');

  fixture.elements.search.value = 'gift-off-sale';
  await fixture.elements.search.dispatchEvent('input');
  assert.equal(optionNodes(fixture).length, 1);
  assert.equal(nodeText(optionNodes(fixture)[0]), 'Off SaleID gift-off-sale · ¥2.00');
  await optionNodes(fixture)[0].dispatchEvent('click');

  assert.equal(fixture.state.addedGifts[0].id, 'gift-off-sale');
  assert.equal(fixture.elements.picker.open, false);
});

test('catalog refreshes do not annotate or highlight saved rules by sale status', async () => {
  const fixture = await createFixture({
    selectedGiftIds: ['gift-0000', 'gift-off-sale', 'guard-1'],
  });
  const rules = fixture.document.getElementById('overtimeRules');
  const assertNoSaleStatus = () => {
    assert.equal(rules.querySelectorAll('[data-rule-sale-status]').length, 0);
    for (const row of rules.querySelectorAll('[data-overtime-rule]')) {
      assert.equal(row.classList.contains('is-unavailable'), false);
    }
  };
  assertNoSaleStatus();
  fixture.namespace.applyGiftCatalog({
    refreshedAt: '2026-09-05T01:00:00.000Z',
    gifts: [],
  });
  assertNoSaleStatus();
  assert.equal(rules.querySelectorAll('[data-overtime-rule]').length, 3);
});

test('reopening the picker invalidates a pending global catalog response', async () => {
  const pending = deferred();
  const newerPending = deferred();
  let catalogRequestCount = 0;
  const fixture = await createFixture({
    globalGifts: [{ id: 'stale-gift', name: 'Stale Gift', rmb: 1 }],
    saleGifts: [{ id: 'current-sale-gift', name: 'Current Sale Gift', rmb: 1 }],
    fetchImpl: () => (catalogRequestCount++ === 0 ? pending.promise : newerPending.promise),
  });
  await openPicker(fixture);

  const loading = fixture.elements.globalSearchButton.dispatchEvent('click');
  await flush();
  assert.equal(fixture.elements.globalSearchButton.disabled, true);
  assert.match(nodeText(fixture.elements.results), /正在读取礼物库/);

  fixture.elements.picker.close();
  fixture.namespace.openGiftPicker();
  await flush();
  assert.equal(fixture.elements.globalSearchButton.disabled, false);
  assert.equal(fixture.elements.globalSearchButton.textContent, '搜索全部礼物');
  assert.ok(optionNodes(fixture).length > 0);

  const newerLoading = fixture.elements.globalSearchButton.dispatchEvent('click');
  await flush();
  assert.equal(fixture.elements.globalSearchButton.disabled, true);

  pending.resolve({
    ok: true,
    payload: {
      ok: true,
      data: { gifts: [{ id: 'stale-gift', name: 'Stale Gift', rmb: 1 }] },
    },
  });
  await loading;
  await flush();

  assert.equal(fixture.elements.globalSearchButton.disabled, true);
  assert.match(nodeText(fixture.elements.results), /正在读取礼物库/);

  newerPending.resolve({
    ok: true,
    payload: {
      ok: true,
      data: { gifts: [{ id: 'newer-gift', name: 'Newer Gift', rmb: 1 }] },
    },
  });
  await newerLoading;
  await flush();

  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  assert.ok(optionNodes(fixture).length > 0);
  assert.equal(nodeText(fixture.elements.results).includes('Stale Gift'), false);
  assert.match(nodeText(fixture.elements.results), /Newer Gift/);
});

test('sale catalog lists guards first then ascending price, labels its room and refreshes through the catalog API', async () => {
  const saleGifts = [
    { id: 'gift-b', name: 'Gift B', rmb: 9 },
    { id: 'gift-a', name: 'Gift A', rmb: 1 },
    { id: 'gift-c', name: 'Gift C', rmb: 1 },
  ];
  const fixture = await createFixture({ saleGifts, initialState: { liveStatus: { roomId: '100', ownerName: '主播A' } } });
  const status = fixture.document.getElementById('overtimeGiftCatalogStatus');
  const refreshedAt = '2026-09-05T00:00:00.000Z';
  fixture.namespace.applyGiftCatalog({ refreshedAt, roomId: '100', count: 3, gifts: saleGifts });
  assert.match(status.textContent, /^在售目录：3 个 · 主播A · /);
  fixture.namespace.applyGiftCatalog({ refreshedAt, roomId: '200', count: 3, gifts: saleGifts });
  assert.match(status.textContent, /^在售目录：3 个 · 200 · /);

  await openPicker(fixture);
  assert.deepEqual(
    optionNodes(fixture).map((node) => nodeText(node).replace(/ID .*/, '')),
    ['总督', '提督', '舰长', 'Gift A', 'Gift C', 'Gift B'],
  );
  fixture.state.apiCalls.length = 0;
  await fixture.document.getElementById('overtimeRefreshGiftsBtn').dispatchEvent('click');
  await flush();
  assert.deepEqual(fixture.state.apiCalls.map(({ url }) => url), ['/api/overtime/gifts/refresh']);
});
