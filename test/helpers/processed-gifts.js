'use strict';

function createGiftSource(giftDb) {
  const timestamp = new Date().toISOString();
  return Number(
    giftDb
      .prepare(
        `
    INSERT INTO gift_sources (source_key, created_at, updated_at) VALUES (?, ?, ?)
  `,
      )
      .run('e'.repeat(64), timestamp, timestamp).lastInsertRowid,
  );
}

function makeProcessedGiftEvent(gift = {}, { eventId = 'gift-1', phase = 'final', cursor = 1 } = {}) {
  return {
    eventId,
    phase,
    cursor: phase === 'progress' ? null : cursor,
    gift: {
      giftId: '33988',
      giftName: '人气票',
      userName: 'Alice',
      num: 1,
      unitPrice: 0.1,
      totalPrice: 0.1,
      coinType: 'gold',
      isBlindBox: false,
      blindBoxId: null,
      blindBoxName: '',
      blindBoxPrice: null,
      blindProfit: null,
      createdAt: new Date().toISOString(),
      ...gift,
    },
  };
}

module.exports = { createGiftSource, makeProcessedGiftEvent };
