'use strict';

function createGiftEventStore(giftDb) {
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create GiftEventStore.');
  }

  function findRecentSameCommandDuplicate(input) {
    return (
      giftDb
        .prepare(
          `
      SELECT * FROM gift_events
      WHERE status = 'active'
        AND created_at BETWEEN ? AND ?
        AND cmd = ?
        AND uid = ? AND gift_id = ? AND gift_name = ? AND num = ?
        AND ABS(total_price - ?) < 0.0001
      ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
    `,
        )
        .get(
          input.startIso,
          input.endIso,
          input.cmd,
          input.uid,
          input.giftId,
          input.giftName,
          input.num,
          input.totalPrice,
        ) || null
    );
  }

  return { findRecentSameCommandDuplicate };
}

module.exports = { createGiftEventStore };
