'use strict';

const { createGiftSyncStore } = require('../storage/gift-sync-store');
const { createGiftRetentionStore } = require('../storage/gift-retention-store');
const { pruneLocalGiftBatch } = require('../storage/gift-local-retention');
const { cleanupGiftRetentionBatch } = require('../storage/gift-retention-cleanup');
const { createGiftRetentionMaintenance } = require('./gift-retention-maintenance');

function createGiftSyncRuntime() {
  let giftDb = null;
  let syncStore = null;
  let retentionStore = null;
  let importLiveEvent = null;
  let maintenance = null;
  let getActiveSource = () => null;

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
      getActiveSource = options.getActiveSource || (() => null);
      maintenance = createGiftRetentionMaintenance({
        canRun: sourceId => {
          const source = getActiveSource();
          return options.automaticEnabled?.() === true && source?.sourceId === sourceId && source.syncState !== 'SOURCE_SWITCHING';
        },
        runBatch(sourceId) {
          const result = pruneLocalGiftBatch(giftDb, sourceId);
          if (result.phase !== 'cleanup') return result;
          const processed = cleanupGiftRetentionBatch(giftDb, sourceId);
          return { ...result, hasMore: processed > 0 };
        },
        onError: (sourceId, error) => console.warn('[Gift retention]', { sourceId, code: error.code || 'MAINTENANCE_FAILED' }),
      });
    },
    startMaintenance() { maintenance?.start(); maintenance?.request(getActiveSource()?.sourceId); },
    requestMaintenance() { maintenance?.request(getActiveSource()?.sourceId); },
    runLocalMaintenance(operation) { return maintenance ? maintenance.runLocal(operation) : operation(); },
    stopMaintenance() { return maintenance?.stop(); },
    dispose() {
      maintenance?.stop();
      maintenance = null;
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
      activateGiftRetention(input) {
        const result = retentionStore.activate(input);
        maintenance?.request(input.sourceId);
        return result;
      },
      pruneLocalGiftRetention(sourceId) {
        maintenance?.request(sourceId);
        return { queued: true };
      },
    },
  };
}

module.exports = { createGiftSyncRuntime };
