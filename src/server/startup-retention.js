'use strict';

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

function startRetentionMaintenance(settingsStore, dataService) {
  let disposed = false;
  let continuation = null;
  function run() {
    if (disposed) return;
    if (continuation) clearTimeout(continuation);
    continuation = null;
    try {
      if (settingsStore.getSettings().autoRetentionOnStartup !== 'true') return;
      const result = dataService.runRetention();
      if (result.hasMoreGiftEvents) {
        continuation = setTimeout(run, 25);
        continuation.unref();
      }
      const { importBatchesDeleted = 0, songCooldownsDeleted = 0 } = result;
      const total =
        result.giftRawJsonCleared +
        result.giftEventsDeleted +
        result.requestsDeleted +
        result.superChatsDeleted +
        result.aiRequestLogsDeleted +
        result.cooldownsDeleted +
        importBatchesDeleted +
        songCooldownsDeleted;
      if (total > 0) {
        console.log(
          `[Retention] rawJson=${result.giftRawJsonCleared} gifts=${result.giftEventsDeleted} requests=${result.requestsDeleted} sc=${result.superChatsDeleted} aiRequests=${result.aiRequestLogsDeleted} cooldowns=${result.cooldownsDeleted} importBatches=${importBatchesDeleted} songCooldowns=${songCooldownsDeleted}`,
        );
      }
    } catch (error) {
      console.warn('[Retention] failed:', error.message);
    }
  }
  run();
  const timer = setInterval(run, RETENTION_INTERVAL_MS);
  timer.unref();
  return () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    if (continuation) clearTimeout(continuation);
    continuation = null;
  };
}

module.exports = { startRetentionMaintenance };
