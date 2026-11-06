'use strict';

const { createGiftSyncStore } = require('../storage/gift-sync-store');
const { createGiftRetentionStore } = require('../storage/gift-retention-store');
const { pruneLocalGiftBatch } = require('../storage/gift-local-retention');
const { cleanupGiftRetentionBatch } = require('../storage/gift-retention-cleanup');

function createGiftSyncRuntime() {
  let giftDb = null;
  let syncStore = null;
  let retentionStore = null;
  let importLiveEvent = null;

  function requireSyncStore() {
    if (!syncStore) throw new Error('Gift sync store not ready.');
    return syncStore;
  }

  return {
    initialize(options) {
      giftDb = options.giftDb;
      syncStore = createGiftSyncStore(options);
      retentionStore = createGiftRetentionStore(options);
      importLiveEvent = options.importLiveEvent;
    },
    dispose() {
      giftDb = null;
      syncStore = null;
      retentionStore = null;
      importLiveEvent = null;
    },
    operations: {
      resolveGiftSource: (sourceKey) => requireSyncStore().resolveSource(sourceKey),
      getGiftSyncState: (sourceId) => requireSyncStore().getState(sourceId),
      commitGiftHistoryPage: (page) => requireSyncStore().commitHistoryPage(page),
      restartGiftHistoryBootstrap: (sourceId, projectionGeneration) =>
        requireSyncStore().restartHistoryBootstrap(sourceId, projectionGeneration),
      commitGiftCatchUpPage: (page) => requireSyncStore().commitCatchUpPage(page),
      commitLegacyGiftPage: (page) => requireSyncStore().commitLegacyPage(page),
      resetGiftProjectionForRebuild: (sourceId) => requireSyncStore().resetProjectionForRebuild(sourceId),
      importProcessedGiftEvent(event, sourceId) {
        if (!importLiveEvent) throw new Error('Gift service not ready.');
        return importLiveEvent(event, sourceId);
      },
      getGiftRetentionProgress: (sourceId) => retentionStore.progress(sourceId),
      restartGiftRetention: (input) => retentionStore.restart(input),
      commitGiftSummaryPage: (input) => retentionStore.summaryPage(input),
      commitRetainedGiftHistoryPage: (input) => retentionStore.historyPage(input),
      activateGiftRetention: (input) => retentionStore.activate(input),
      pruneLocalGiftRetention(sourceId) {
        const result = pruneLocalGiftBatch(giftDb, sourceId);
        if (!result.deleted) cleanupGiftRetentionBatch(giftDb, sourceId);
        return result;
      },
    },
  };
}

module.exports = { createGiftSyncRuntime };
