'use strict';

function runStartupRetention(settingsStore, dataService) {
  if (settingsStore.getSettings().autoRetentionOnStartup !== 'true') return;
  try {
    const result = dataService.runRetention();
    const total =
      result.giftRawJsonCleared +
      result.giftEventsDeleted +
      result.requestsDeleted +
      result.superChatsDeleted +
      result.cooldownsDeleted;
    if (total > 0) {
      console.log(
        `[Startup] retention: rawJson=${result.giftRawJsonCleared} gifts=${result.giftEventsDeleted} requests=${result.requestsDeleted} sc=${result.superChatsDeleted} cooldowns=${result.cooldownsDeleted}`,
      );
    }
  } catch (error) {
    console.warn('[Startup] retention failed:', error.message);
  }
}

module.exports = { runStartupRetention };
