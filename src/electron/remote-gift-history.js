'use strict';

const { canRestartBootstrap, giftSyncStalledError } = require('./remote-gift-recovery-rules');

async function bootstrapGiftHistory({ state, discovery, signal, isCurrent, readPage, commitPage, restart }) {
  let pageToken = state.bootstrapPageToken;
  const seenPageTokens = new Set(pageToken === null ? [] : [pageToken]);
  let restarted = false;
  while (isCurrent()) {
    let page;
    try {
      page = await readPage({ pageToken, signal });
    } catch (error) {
      if (canRestartBootstrap(error) && !restarted && isCurrent()) {
        state = restart();
        if (!isCurrent()) return false;
        restarted = true;
        pageToken = null;
        continue;
      }
      throw error;
    }
    if (!isCurrent()) return false;
    if (
      page.syncEpoch !== discovery.syncEpoch ||
      (state.bootstrapRecoveryCursor !== null && state.bootstrapRecoveryCursor !== page.recoveryCursor) ||
      (state.bootstrapSyncEpoch !== null && state.bootstrapSyncEpoch !== page.syncEpoch)
    ) {
      const mismatch = new Error('GIFT_BOOTSTRAP_SNAPSHOT_MISMATCH');
      mismatch.code = 'REBUILD_REQUIRED';
      throw mismatch;
    }
    if (page.hasMore && seenPageTokens.has(page.nextPageToken)) throw giftSyncStalledError();
    state = commitPage(page);
    if (!isCurrent()) return false;
    pageToken = page.nextPageToken;
    if (pageToken !== null) seenPageTokens.add(pageToken);
    if (!page.hasMore) return true;
  }
  return false;
}

module.exports = { bootstrapGiftHistory };
