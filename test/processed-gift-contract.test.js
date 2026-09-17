'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readServerFixture } = require('../scripts/verify-server-contract');
const {
  canonicalCoinType,
  canonicalGiftId,
  canonicalGiftText,
  normalizeProcessedGiftEvent,
  normalizeProcessedGiftHistoryPage,
  normalizeProcessedGiftPage,
} = require('../src/shared/processed-gift-contract');
const {
  createFixture,
  makeEvent,
} = require('./helpers/processed-gift-fixture');

const giftSyncFixture = readServerFixture('docs/protocol/fixtures/gift-sync-v1.json');

test('processed importer rejects malformed or privacy-sensitive transport shapes', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () =>
        fixture.importProcessedEvent({
          ...makeEvent('final', 1),
          eventId: '../tenant',
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );
    assert.throws(
      () =>
        fixture.importProcessedEvent({
          ...makeEvent('final', 1),
          gift: { ...makeEvent('final', 1).gift, totalPrice: 0 },
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );
    assert.throws(
      () =>
        fixture.importProcessedEvent({
          ...makeEvent('final', 1),
          gift: { ...makeEvent('final', 1).gift, totalPrice: 0.001 },
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );

    const imported = fixture.importProcessedEvent({
      ...makeEvent('final', 13),
      uid: 'must-not-be-used',
      rawJson: '{"secret":true}',
      gift: {
        ...makeEvent('final', 13).gift,
        uid: 'must-not-be-used',
        rawJson: '{"secret":true}',
      },
    });
    assert.equal(imported.uid, '');
    assert.equal(imported.raw_json, '');
  } finally {
    fixture.close();
  }
});

test('gift sync contract consumes the shared server fixture', () => {
  const canonicalCase = giftSyncFixture.canonicalCases.find(
    ({ name }) => name === 'canonical-paid-blind-box',
  );
  const coinTypeCase = giftSyncFixture.canonicalCases.find(
    ({ name }) => name === 'coin-type-normalizes-to-nfc',
  );
  assert.ok(canonicalCase);
  assert.ok(coinTypeCase);
  assert.equal(canonicalGiftId(' １２3 '), '１２3');
  assert.equal(
    canonicalGiftText(canonicalCase.input.gift.giftName),
    canonicalCase.expected.record.gift.giftName,
  );
  assert.equal(canonicalGiftText('A\u0085B'), 'A B');
  assert.equal(canonicalCoinType(' GOLD '), 'gold');
  assert.equal(
    canonicalCoinType(coinTypeCase.input.gift.coinType),
    coinTypeCase.expected.record.gift.coinType,
  );

  const historyPage = normalizeProcessedGiftHistoryPage(
    structuredClone(giftSyncFixture.bootstrapPage.response),
  );
  assert.equal(historyPage.events[0].gift.totalPriceCents, 250);
  assert.equal(
    historyPage.recoveryCursor,
    giftSyncFixture.bootstrapPage.response.recoveryCursor,
  );
  assert.equal(
    historyPage.historyBootstrapVersion,
    giftSyncFixture.historyBootstrapVersion,
  );

  for (const cursorCase of giftSyncFixture.cursorCases) {
    if (!cursorCase.response) continue;
    const page = normalizeProcessedGiftPage(
      structuredClone(cursorCase.response),
    );
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
    assert.throws(
      () => normalizeProcessedGiftHistoryPage(page),
      /INVALID_PROCESSED_GIFT_HISTORY_PAGE/,
    );
  }

  const imprecise = structuredClone(giftSyncFixture.bootstrapPage.response);
  imprecise.events[0].gift.unitPrice = 1.0000000009;
  imprecise.events[0].gift.totalPrice = 2.0000000009;
  imprecise.events[0].gift.blindBoxPrice = 1.5;
  imprecise.events[0].gift.blindProfit = 0.5;
  assert.equal(
    normalizeProcessedGiftHistoryPage(imprecise).events[0].gift.unitPriceCents,
    100,
  );

  const invalidMoney = structuredClone(giftSyncFixture.bootstrapPage.response);
  invalidMoney.events[0].gift.unitPrice = 1.001;
  assert.throws(
    () => normalizeProcessedGiftHistoryPage(invalidMoney),
    /INVALID_PROCESSED_GIFT_HISTORY_PAGE/,
  );
});

test('incremental wire contract is exact for v1 pages, events, and gifts', () => {
  const fixturePage = structuredClone(
    giftSyncFixture.cursorCases.find(
      ({ name }) => name === 'epoch-aware-no-update',
    ).response,
  );
  const historyRecord = structuredClone(
    giftSyncFixture.bootstrapPage.response.events[0],
  );
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
    assert.throws(
      () => normalizeProcessedGiftPage(page),
      /INVALID_PROCESSED_GIFT_PAGE/,
    );
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
