'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readServerFixture } = require('../../scripts/verify-server-contract');
const {
  canonicalCoinType,
  canonicalGiftId,
  canonicalGiftText,
  normalizeProcessedGiftEvent,
  normalizeProcessedGiftHistoryPage,
  normalizeProcessedGiftPage,
} = require('../../src/shared/processed-gift-contract');
const { getGiftSnapshot } = require('../../src/bilibili/gift/query-service');
const { createGiftQueryStore } = require('../../src/storage/gift-query-store');
const { createFixture, makeEvent } = require('../helpers/processed-gift-fixture');

const giftSyncFixture = readServerFixture('docs/protocol/fixtures/gift-sync-v1.json');
const heartBox = readServerFixture('test/fixtures/heart-blind-box-events.json');

test('heart-box output metadata survives remote import and recent snapshot projection', () => {
  const fixture = createFixture();
  try {
    for (const [index, item] of heartBox.outputs.entries()) {
      const event = makeEvent('final', index + 1, {
        giftId: item.id,
        giftName: item.name,
        unitPrice: item.rmb,
        totalPrice: item.rmb,
        isBlindBox: true,
        blindBoxId: heartBox.box.id,
        blindBoxName: heartBox.box.name,
        blindBoxPrice: heartBox.box.rmb,
        blindProfit: item.profit,
      });
      event.eventId = `heart-output-${index}`;
      fixture.importProcessedEvent(event);
      fixture.importProcessedEvent(event);
    }
    const snapshot = getGiftSnapshot({
      queryStore: createGiftQueryStore(fixture.db.giftDb),
      getActiveGiftSource: () => ({ sourceId: fixture.sourceId }),
    });
    assert.equal(snapshot.recent.length, 2);
    for (const item of heartBox.outputs) {
      const row = snapshot.recent.find((gift) => gift.gift_id === item.id);
      assert.equal(row.is_blind_box, true);
      assert.equal(row.blind_box_id, heartBox.box.id);
      assert.equal(row.blind_box_name, heartBox.box.name);
      assert.equal(row.total_price, item.rmb);
      assert.equal(row.blind_box_price, heartBox.box.rmb);
      assert.equal(row.blind_profit, item.profit);
    }
  } finally {
    fixture.close();
  }
});

test('negotiated identity fixture imports atomically, rejects rebinding, and accepts legacy replay', () => {
  const event = structuredClone(readServerFixture('docs/protocol/fixtures/gift-event-identity.json').event);
  const fixture = createFixture();
  try {
    const normalized = normalizeProcessedGiftEvent(event);
    const row = fixture.importProcessedEvent(normalized);
    assert.equal(row.gift_variant_id, event.gift.giftVariantId);
    assert.equal(row.blind_box_variant_id, null);
    const changed = structuredClone(event);
    changed.gift.giftVariantId = `gv_${'f'.repeat(64)}`;
    assert.throws(() => fixture.importProcessedEvent(changed), /PROCESSED_GIFT_EVENT_CONFLICT/);
    const legacy = structuredClone(event);
    delete legacy.gift.giftVariantId;
    delete legacy.gift.blindBoxVariantId;
    assert.equal(fixture.importProcessedEvent(legacy).gift_variant_id, event.gift.giftVariantId);
    const malformed = structuredClone(event);
    delete malformed.gift.blindBoxVariantId;
    assert.throws(() => normalizeProcessedGiftEvent(malformed), /INVALID_PROCESSED_GIFT_EVENT/);
    malformed.gift.blindBoxVariantId = 'not-an-identity';
    assert.throws(() => normalizeProcessedGiftEvent(malformed), /INVALID_PROCESSED_GIFT_EVENT/);
  } finally {
    fixture.close();
  }
});

test('gift sync contract consumes the shared server fixture', () => {
  const canonicalCase = giftSyncFixture.canonicalCases.find(({ name }) => name === 'canonical-paid-blind-box');
  const coinTypeCase = giftSyncFixture.canonicalCases.find(({ name }) => name === 'coin-type-normalizes-to-nfc');
  assert.ok(canonicalCase);
  assert.ok(coinTypeCase);
  assert.equal(canonicalGiftId(' １２3 '), '１２3');
  assert.equal(canonicalGiftText(canonicalCase.input.gift.giftName), canonicalCase.expected.record.gift.giftName);
  assert.equal(canonicalGiftText('A\u0085B'), 'A B');
  assert.equal(canonicalCoinType(' GOLD '), 'gold');
  assert.equal(canonicalCoinType(coinTypeCase.input.gift.coinType), coinTypeCase.expected.record.gift.coinType);

  const historyPage = normalizeProcessedGiftHistoryPage(structuredClone(giftSyncFixture.bootstrapPage.response));
  assert.equal(historyPage.events[0].gift.totalPriceCents, 250);
  assert.equal(historyPage.recoveryCursor, giftSyncFixture.bootstrapPage.response.recoveryCursor);
  assert.equal(historyPage.historyBootstrapVersion, giftSyncFixture.historyBootstrapVersion);

  for (const cursorCase of giftSyncFixture.cursorCases) {
    if (!cursorCase.response) continue;
    const page = normalizeProcessedGiftPage(structuredClone(cursorCase.response));
    assert.equal(page.nextCursor, cursorCase.response.nextCursor);
  }
});

test('history wire contract rejects incomplete, coerced, or extended pages atomically', () => {
  const invalidMutations = [
    (page) => delete page.ok,
    (page) => {
      page.ok = 'true';
    },
    (page) => {
      page.extra = true;
    },
    (page) => {
      page.recoveryCursor = String(page.recoveryCursor);
    },
    (page) => {
      page.syncEpoch = 1;
    },
    (page) => {
      page.syncEpoch = 'x'.repeat(129);
    },
    (page) => {
      page.nextPageToken = 'x'.repeat(4097);
    },
    (page) => {
      page.events[0].extra = true;
    },
    (page) => {
      page.events[0].gift.extra = true;
    },
    (page) => delete page.events[0].gift.userName,
    (page) => {
      page.events[0].gift.userName = 123;
    },
    (page) => delete page.events[0].gift.coinType,
    (page) => {
      page.events[0].gift.coinType = 123;
    },
    (page) => delete page.events[0].gift.isBlindBox,
    (page) => {
      page.events[0].gift.isBlindBox = 1;
    },
    (page) => delete page.events[0].gift.blindBoxId,
    (page) => {
      page.events[0].gift.blindBoxId = '0';
    },
    (page) => delete page.events[0].gift.blindBoxName,
    (page) => delete page.events[0].gift.blindBoxPrice,
    (page) => {
      page.events[0].gift.blindBoxPrice = '2';
    },
    (page) => delete page.events[0].gift.blindProfit,
    (page) => {
      page.events[0].gift.blindProfit = '0.5';
    },
  ];

  for (const mutate of invalidMutations) {
    const page = structuredClone(giftSyncFixture.bootstrapPage.response);
    mutate(page);
    assert.throws(() => normalizeProcessedGiftHistoryPage(page), /INVALID_PROCESSED_GIFT_HISTORY_PAGE/);
  }

  const imprecise = structuredClone(giftSyncFixture.bootstrapPage.response);
  imprecise.events[0].gift.unitPrice = 1.0000000009;
  imprecise.events[0].gift.totalPrice = 2.0000000009;
  imprecise.events[0].gift.blindBoxPrice = 1.5;
  imprecise.events[0].gift.blindProfit = 0.5;
  assert.equal(normalizeProcessedGiftHistoryPage(imprecise).events[0].gift.unitPriceCents, 100);

  const invalidMoney = structuredClone(giftSyncFixture.bootstrapPage.response);
  invalidMoney.events[0].gift.unitPrice = 1.001;
  assert.throws(() => normalizeProcessedGiftHistoryPage(invalidMoney), /INVALID_PROCESSED_GIFT_HISTORY_PAGE/);
});

test('incremental wire contract is exact for v1 pages, events, and gifts', () => {
  const fixturePage = structuredClone(
    giftSyncFixture.cursorCases.find(({ name }) => name === 'epoch-aware-no-update').response,
  );
  const historyRecord = structuredClone(giftSyncFixture.bootstrapPage.response.events[0]);
  fixturePage.events = [{ ...historyRecord, cursor: 42, phase: 'final' }];
  fixturePage.nextCursor = 42;
  fixturePage.latestCursor = 42;
  assert.equal(normalizeProcessedGiftPage(fixturePage).events.length, 1);

  const invalidMutations = [
    (page) => delete page.ok,
    (page) => {
      page.ok = false;
    },
    (page) => {
      page.extra = true;
    },
    (page) => delete page.syncEpoch,
    (page) => {
      page.nextCursor = '42';
    },
    (page) => {
      page.historyBootstrapVersion = '1';
    },
    (page) => {
      page.syncEpoch = 'x'.repeat(129);
    },
    (page) => {
      page.earliestCursor = '1';
    },
    (page) => {
      page.latestCursor = '42';
    },
    (page) => {
      page.events[0].extra = true;
    },
    (page) => {
      page.events[0].gift.extra = true;
    },
    (page) => {
      page.events[0].cursor = '42';
    },
    (page) => {
      page.events[0].gift.num = '2';
    },
    (page) => {
      page.events[0].gift.isBlindBox = 1;
    },
  ];

  for (const mutate of invalidMutations) {
    const page = structuredClone(fixturePage);
    mutate(page);
    assert.throws(() => normalizeProcessedGiftPage(page), /INVALID_PROCESSED_GIFT_PAGE/);
  }

  assert.deepEqual(
    normalizeProcessedGiftPage({
      ok: true,
      events: [],
      nextCursor: 5,
      hasMore: false,
    }),
    {
      ok: true,
      events: [],
      nextCursor: 5,
      hasMore: false,
    },
  );

  assert.throws(
    () =>
      normalizeProcessedGiftEvent({
        ...fixturePage.events[0],
        uid: 'not-allowed',
      }),
    /INVALID_PROCESSED_GIFT_EVENT/,
  );
});
