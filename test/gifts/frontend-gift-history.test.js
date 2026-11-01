'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createGiftHistoryFixture } = require('../helpers/gift-history-fixture');

const ROOT_DIR = path.join(__dirname, '../..');

test('gift history builds pagination, sorting and filter requests and reports sync state', async () => {
  const modulePath = path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'history.js');
  const ledger = await loadModuleExports(modulePath, {
    document: {},
    location: {},
    URLSearchParams,
  });

  assert.equal(ledger.buildGiftHistoryUrl(), '/api/gifts/history?range=all&limit=100');
  assert.equal(
    ledger.buildGiftHistoryUrl({ sourceId: 'private-source', source_id: 'private-source' }),
    '/api/gifts/history?range=all&limit=100',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({
      cursor: 'opaque/+ token',
      limit: 50,
    }),
    '/api/gifts/history?range=all&limit=50&cursor=opaque%2F%2B+token',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({
      limit: 50,
      sortField: 'price',
      sortDirection: 'asc',
    }),
    '/api/gifts/history?range=all&limit=50&sortField=price&sortDirection=asc',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({ sortField: null, sortDirection: null }),
    '/api/gifts/history?range=all&limit=100',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({ filters: { amountAbove: '10.01' } }),
    '/api/gifts/history?range=all&limit=100&amountAbove=10.01',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({ filters: { amountAbove: 0 } }),
    '/api/gifts/history?range=all&limit=100&amountAbove=0',
  );
  assert.equal(ledger.buildGiftHistoryUrl({ filters: { amountAbove: '' } }), '/api/gifts/history?range=all&limit=100');
  assert.equal(ledger.describeGiftSyncStatus('LIVE', false).state, 'live');
  assert.equal(ledger.describeGiftSyncStatus('LIVE', true).state, 'partial');
  assert.equal(ledger.describeGiftSyncStatus('LEGACY_PARTIAL', true).state, 'partial');
  assert.equal(ledger.describeGiftSyncStatus('OFFLINE', true).state, 'offline');
  assert.equal(ledger.describeGiftSyncStatus('ERROR', true).state, 'error');
});

test('gift history headers sort from page one with click and keyboard input', async () => {
  const headers = ['created_at', 'gift_name', 'price', 'remarks'].map((sort) => {
    const arrow = { textContent: '' };
    const attributes = new Map();
    return {
      dataset: { sort },
      handlers: {},
      arrow,
      attributes,
      querySelector(selector) {
        return selector === '.sort-arrow' ? arrow : null;
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      addEventListener(type, handler) {
        this.handlers[type] = handler;
      },
    };
  });
  const requests = [];
  const { elements } = await createGiftHistoryFixture({
    headers,
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            data: {
              items: [],
              hasMore: false,
              total: 0,
              totalPages: 1,
              syncState: 'LIVE',
              partial: false,
            },
          }),
      };
    },
  });

  elements.get('giftHistoryOpenBtn').handlers.click();
  await new Promise(setImmediate);
  headers[1].handlers.click();
  await new Promise(setImmediate);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100&sortField=gift_name&sortDirection=asc');
  headers[1].handlers.click();
  await new Promise(setImmediate);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100&sortField=gift_name&sortDirection=desc');
  headers[1].handlers.click();
  await new Promise(setImmediate);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100');
  headers[2].handlers.keydown({
    key: 'Enter',
    preventDefault() {},
  });
  await new Promise(setImmediate);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100&sortField=price&sortDirection=asc');
  const header = headers[0];
  for (const direction of ['asc', 'desc', null]) {
    header.handlers.click();
    await new Promise(setImmediate);
    const params = new URL(requests.at(-1), 'http://localhost').searchParams;
    const isDefault = direction !== 'asc';
    assert.equal(params.get('sortField'), isDefault ? null : header.dataset.sort);
    assert.equal(params.get('sortDirection'), isDefault ? null : direction);
  }
  assert.equal(
    requests.some((url) => /source(?:Id|_id)/u.test(url)),
    false,
  );
});

test('loadGiftHistory requests one history page and renders canonical escaped rows', async () => {
  const requests = [];
  const { ledger, elements } = await createGiftHistoryFixture({
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            data: {
              items: [
                {
                  eventId: 'event-escaped',
                  sourceId: 'private-source',
                  gift: {
                    source_id: 'private-source',
                    createdAt: '2025-01-02T03:04:05.000Z',
                    giftName: '<script>alert("gift")</script>',
                    num: 2,
                    totalPrice: 12.56,
                    userName: 'Alice & <img src=x>',
                    isBlindBox: true,
                    blindProfit: -3.56,
                    blindBoxName: 'Box <one>',
                  },
                },
                {
                  eventId: 'event-unknown-cost',
                  gift: {
                    createdAt: '2025-01-03T03:04:05.000Z',
                    giftName: '心动盲盒',
                    num: 1,
                    totalPrice: 0,
                    userName: 'Bob',
                    isBlindBox: true,
                    blindProfit: null,
                  },
                },
              ],
              nextCursor: 'next-page-token',
              hasMore: true,
              total: 52,
              totalPages: 2,
              syncState: 'LIVE',
              partial: false,
              syncedAt: '2025-01-03T04:05:06.000Z',
            },
          }),
      };
    },
  });

  await ledger.loadGiftHistory();

  assert.deepEqual(requests, ['/api/gifts/history?range=all&limit=100']);
  const body = elements.get('giftHistoryBody').innerHTML;
  assert.doesNotMatch(body, /private-source/);
  assert.match(body, /&lt;script&gt;alert\(&quot;gift&quot;\)&lt;\/script&gt;/);
  assert.match(body, /Alice &amp; &lt;img src=x&gt;/);
  assert.doesNotMatch(body, /<script>alert\("gift"\)<\/script>/);
  assert.match(body, /盲盒 -¥3\.56/);
  assert.match(body, /Box &lt;one&gt;/);
  assert.match(body, /盲盒 成本未知/);
  assert.equal(elements.get('giftHistoryNext').disabled, false);
});

test('gift history keeps cursor navigation, ignores responses after close, and reloads on reopen', async () => {
  const ui = await createGiftHistoryFixture();
  const { elements, requests, click } = ui;
  const finishRequest = (data) => ui.reply({ ok: true, data });
  const firstPage = {
    items: [{ eventId: 'first', gift: { giftName: '测试礼物' } }],
    hasMore: true,
    nextCursor: 'page-2',
    total: 2,
    totalPages: 2,
    syncState: 'LIVE',
    partial: false,
  };

  click('giftHistoryOpenBtn');
  await finishRequest(firstPage);
  assert.match(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
  click('giftHistoryNext');
  await finishRequest({
    items: [{ eventId: 'second', gift: { giftName: '另一礼物' } }],
    total: 2,
    totalPages: 2,
    syncState: 'OFFLINE',
    partial: true,
  });
  assert.equal(requests.at(-1).url, '/api/gifts/history?range=all&limit=100&cursor=page-2');
  click('giftHistoryPrev');
  await finishRequest(firstPage);
  assert.equal(requests.at(-1).url, '/api/gifts/history?range=all&limit=100');

  click('giftHistoryNext');
  const countBeforeClose = requests.length;
  click('giftHistoryClose');
  const bodyBeforeResponse = elements.get('giftHistoryBody').innerHTML;
  await finishRequest(firstPage);
  assert.equal(requests.length, countBeforeClose);
  assert.equal(elements.get('giftHistoryBody').innerHTML, bodyBeforeResponse);
  assert.doesNotMatch(elements.get('giftHistoryBody').innerHTML, /测试礼物/);

  click('giftHistoryOpenBtn');
  await finishRequest(firstPage);
  assert.equal(requests.at(-1).url, '/api/gifts/history?range=all&limit=100');
  assert.match(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
});
