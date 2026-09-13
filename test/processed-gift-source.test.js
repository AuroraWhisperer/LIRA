'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeProcessedGiftEvent,
} = require('../src/shared/processed-gift-contract');
const {
  createFixture,
  makeEvent,
} = require('./helpers/processed-gift-fixture');

test('processed live importer requires an explicit captured source', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => fixture.detection.importProcessedEvent(makeEvent('final', 15)),
      /REMOTE_GIFT_SOURCE_REQUIRED/,
    );
  } finally {
    fixture.close();
  }
});

test('negotiated identity fixture imports atomically, rejects rebinding, and accepts legacy replay', () => {
  const event = structuredClone(
    require('../../lira-server/docs/protocol/fixtures/gift-event-identity.json')
      .event,
  );
  const fixture = createFixture();
  try {
    const normalized = normalizeProcessedGiftEvent(event);
    const row = fixture.importProcessedEvent(normalized);
    assert.equal(row.gift_variant_id, event.gift.giftVariantId);
    assert.equal(row.blind_box_variant_id, null);
    const changed = structuredClone(event);
    changed.gift.giftVariantId = `gv_${'f'.repeat(64)}`;
    assert.throws(
      () => fixture.importProcessedEvent(changed),
      /PROCESSED_GIFT_EVENT_CONFLICT/,
    );
    const legacy = structuredClone(event);
    delete legacy.gift.giftVariantId;
    delete legacy.gift.blindBoxVariantId;
    assert.equal(
      fixture.importProcessedEvent(legacy).gift_variant_id,
      event.gift.giftVariantId,
    );
    const malformed = structuredClone(event);
    delete malformed.gift.blindBoxVariantId;
    assert.throws(
      () => normalizeProcessedGiftEvent(malformed),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );
    malformed.gift.blindBoxVariantId = 'not-an-identity';
    assert.throws(
      () => normalizeProcessedGiftEvent(malformed),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );
  } finally {
    fixture.close();
  }
});
