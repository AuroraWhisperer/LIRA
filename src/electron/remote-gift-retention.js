'use strict';

const { validateEpochAwareCursorPage, giftSyncStalledError } = require('./remote-gift-recovery-rules');

// All mutations are fenced by both the controller and the persisted projection generation.
// Tokens live in the store so a rate limit, network loss or restart resumes the same snapshot.
async function syncRetainedGifts({ runtime, licenseManager, sourceId, projectionGeneration, syncEpoch, full, signal, isCurrent }) {
  const scope = { sourceId, projectionGeneration };
  let progress = runtime.getGiftRetentionProgress(sourceId);
  if (progress.staging && (progress.staging.sync_epoch !== syncEpoch ||
    progress.staging.projection_generation !== projectionGeneration ||
    (full && progress.staging.member_snapshot_id !== progress.staging.id))) {
    progress = runtime.restartGiftRetention(scope);
  }
  let restarted = false;
  while (isCurrent()) {
    try {
      if (!progress.staging || progress.staging.phase === 'summaries') {
        const pageToken = progress.staging?.summary_page_token ?? null;
        const page = await licenseManager.getGiftSummariesInternal({
          pageToken, afterRevision: full ? 0 : progress.active?.revision ?? 0, signal,
        });
        if (!isCurrent()) return false;
        if (page.syncEpoch !== syncEpoch) throw Object.assign(new Error('SYNC_EPOCH_MISMATCH'), { code: 'SYNC_EPOCH_MISMATCH' });
        if (!full && !progress.staging && progress.active?.revision === page.revision &&
          progress.active.detail_start === page.detailStart && !page.hasMore && page.rows.length === 0) return true;
        if (page.hasMore && page.nextPageToken === pageToken) throw giftSyncStalledError();
        progress = runtime.commitGiftSummaryPage({ ...scope, page, pageToken, full });
        continue;
      }
      if (progress.staging.phase === 'history') {
        const pageToken = progress.staging.history_page_token;
        const page = await licenseManager.getGiftHistoryInternal({ pageToken, signal });
        if (!isCurrent()) return false;
        if (page.hasMore && page.nextPageToken === pageToken) throw giftSyncStalledError();
        progress = runtime.commitRetainedGiftHistoryPage({ ...scope, page, pageToken });
        continue;
      }
      const staging = progress.staging;
      const replacing = staging.member_snapshot_id === staging.id;
      const state = runtime.getGiftSyncState(sourceId);
      const cursor = replacing ? staging.recovery_cursor : state.finalCursor;
      // The history snapshot already reaches the summary coverage watermark.
      // Finals after that snapshot go through the existing live catch-up after
      // activation, preserving its local eligibility and consumer effects.
      if (!replacing && cursor < staging.covered_cursor) {
        const page = await licenseManager.getGiftEventsInternal({ after: cursor, limit: 200, syncEpoch, signal });
        if (!isCurrent()) return false;
        if (page.syncEpoch !== syncEpoch) throw Object.assign(new Error('SYNC_EPOCH_MISMATCH'), { code: 'SYNC_EPOCH_MISMATCH' });
        validateEpochAwareCursorPage(page, cursor);
        runtime.commitGiftCatchUpPage({ ...scope, events: page.events, nextCursor: page.nextCursor, syncEpoch });
        if (page.hasMore) continue;
      }
      runtime.activateGiftRetention(scope);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (!restarted && ['BOOTSTRAP_TOKEN_EXPIRED', 'INVALID_BOOTSTRAP_TOKEN', 'GIFT_QUERY_SNAPSHOT_EXPIRED'].includes(error.code)) {
        if (error.code === 'GIFT_QUERY_SNAPSHOT_EXPIRED' && !progress.staging) full = true;
        progress = runtime.restartGiftRetention(scope);
        restarted = true;
        continue;
      }
      throw error;
    }
  }
  return false;
}

module.exports = { syncRetainedGifts };
