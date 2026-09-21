'use strict';

// Caller owns the existing transaction and all event deletion scope.
function resetGiftProjectionMetadataInTransaction(giftDb, sourceId, timestamp) {
  const reset = giftDb
    .prepare(
      `
        UPDATE gift_sync_state
        SET sync_epoch = NULL, final_cursor = NULL,
            bootstrap_complete = 0, bootstrap_page_token = NULL,
            bootstrap_recovery_cursor = NULL,
            bootstrap_sync_epoch = NULL,
            projection_generation = projection_generation + 1,
            last_validated_at = NULL, updated_at = ?
        WHERE source_id = ?
      `,
    )
    .run(timestamp, sourceId);
  if (Number(reset.changes) !== 1) throw new Error('GIFT_SOURCE_NOT_FOUND');
  const state = giftDb
    .prepare(
      `
        SELECT projection_generation
        FROM gift_sync_state
        WHERE source_id = ?
      `,
    )
    .get(sourceId);
  return Number(state.projection_generation);
}

module.exports = { resetGiftProjectionMetadataInTransaction };
