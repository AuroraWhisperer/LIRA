// 编写人：Aurora
// 礼物冲刺服务入口。
'use strict';

const {
  repairGiftV2Events
} = require('./event-service');
const { createGiftDetectionService } = require('./detection-service');
const { createGiftConsumerRegistry } = require('./consumer-registry');
const { createGiftStatisticsConsumer } = require('./statistics-consumer');
const {
  CRYSTAL_BALL_VALUE_RMB,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftSprintSnapshot,
  searchGifts,
  clearRecentGifts
} = require('./query-service');
const {
  getBlindBoxStats,
  getBlindBoxAnalysis
} = require('./blind-box-analysis');
const {
  normalizeGiftRow,
  normalizeGiftInput
} = require('./normalizer');

function createGiftService(context, options = {}) {
  const statisticsConsumer = options.statisticsConsumer || createGiftStatisticsConsumer({
    giftDb: context.db.giftDb
  });
  const consumerRegistry = options.consumerRegistry || createGiftConsumerRegistry({
    consumers: [statisticsConsumer, ...(options.consumers || [])],
    onError: options.onConsumerError
  });
  const detectionService = createGiftDetectionService(context, {
    ...options,
    consumerRegistry
  });
  return {
    ...detectionService,
    add: detectionService.detect,
    getSnapshot: () => getGiftSnapshot(context),
    getHistory: (queryOptions) => getGiftHistory(context, queryOptions),
    getSprintSnapshot: () => getGiftSprintSnapshot(context),
    getBlindBoxStats: (queryOptions) => getBlindBoxStats(context, queryOptions),
    getBlindBoxAnalysis: (queryOptions) => getBlindBoxAnalysis(context, queryOptions),
    resetSprint: () => resetGiftSprintProgress(context),
    search: (queryOptions) => searchGifts(context, queryOptions || {}),
    clearRecent: () => clearRecentGifts(context)
  };
}

module.exports = {
  CRYSTAL_BALL_VALUE_RMB,
  createGiftService,
  createGiftDetectionService,
  createGiftConsumerRegistry,
  createGiftStatisticsConsumer,
  repairGiftV2Events,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftSprintSnapshot,
  getBlindBoxAnalysis,
  getBlindBoxStats,
  searchGifts,
  normalizeGiftRow,
  normalizeGiftInput,
  clearRecentGifts
};
