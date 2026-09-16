'use strict';

function createGiftStatisticsConsumer({ store }) {
  if (!store)
    throw new Error('store is required to create GiftStatisticsConsumer.');
  function handle(event) {
    if (event?.phase !== 'final' || event.eligibility?.giftStatistics !== true)
      return false;
    const giftEventId = Number(event.giftEventId) || 0;
    return giftEventId > 0 ? store.deliverOnce(giftEventId) : false;
  }

  return { name: 'giftStatistics', handle };
}

module.exports = { createGiftStatisticsConsumer };
