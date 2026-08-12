'use strict';

function createGiftStatisticsConsumer({ giftDb }) {
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create GiftStatisticsConsumer.');
  }

  function handle(event) {
    if (event?.phase !== 'final' || event.eligibility?.giftStatistics !== true) return false;
    const giftEventId = Number(event.giftEventId) || 0;
    if (giftEventId <= 0) return false;

    giftDb.exec('BEGIN IMMEDIATE');
    try {
      const row = giftDb.prepare(`
        SELECT total_price, gift_stats_eligible, gift_stats_delivered
        FROM gift_events
        WHERE id = ? AND detection_status = 'final'
      `).get(giftEventId);
      if (!row || Number(row.gift_stats_eligible) !== 1 || Number(row.gift_stats_delivered) === 1) {
        giftDb.exec('COMMIT');
        return false;
      }

      giftDb.prepare(`
        UPDATE gift_events
        SET counted_in_sprint = ?, gift_stats_delivered = 1
        WHERE id = ? AND gift_stats_delivered = 0
      `).run(Number(row.total_price) > 0 ? 1 : 0, giftEventId);
      giftDb.exec('COMMIT');
      return true;
    } catch (error) {
      giftDb.exec('ROLLBACK');
      throw error;
    }
  }

  return { name: 'giftStatistics', handle };
}

module.exports = { createGiftStatisticsConsumer };
