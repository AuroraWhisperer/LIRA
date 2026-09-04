// 编写人：Aurora
// 礼物冲刺服务入口。
'use strict';

const { repairGiftV2Events } = require('./event-service');
const { createGiftDetectionService } = require('./detection-service');
const { createGiftConsumerRegistry } = require('./consumer-registry');
const { createGiftStatisticsConsumer } = require('./statistics-consumer');
const {
  CRYSTAL_BALL_VALUE_RMB,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftStatistics,
  getGiftSprintSnapshot,
  searchGifts,
  clearRecentGifts,
} = require('./query-service');
const {
  getBlindBoxStats,
  getBlindBoxAnalysis,
} = require('./blind-box-analysis');
const { normalizeGiftRow, normalizeGiftInput } = require('./normalizer');

function createGiftService(context, options = {}) {
  let activeGiftSource = null;
  const giftContext = {
    ...context,
    getActiveGiftSource: () => activeGiftSource,
  };
  const statisticsConsumer =
    options.statisticsConsumer ||
    createGiftStatisticsConsumer({
      giftDb: context.db.giftDb,
    });
  const consumerRegistry =
    options.consumerRegistry ||
    createGiftConsumerRegistry({
      consumers: [statisticsConsumer, ...(options.consumers || [])],
      onError: options.onConsumerError,
    });
  const detectionService = createGiftDetectionService(giftContext, {
    ...options,
    consumerRegistry,
  });
  return {
    ...detectionService,
    add: detectionService.detect,
    getSnapshot: () => getGiftSnapshot(giftContext),
    getHistory: (queryOptions) => getGiftHistory(giftContext, queryOptions),
    getStatistics: (queryOptions) =>
      getGiftStatistics(giftContext, queryOptions),
    getSprintSnapshot: () => getGiftSprintSnapshot(giftContext),
    getBlindBoxStats: (queryOptions) =>
      getBlindBoxStats(giftContext, queryOptions),
    getBlindBoxAnalysis: (queryOptions) =>
      getBlindBoxAnalysis(giftContext, queryOptions),
    resetSprint: () => resetGiftSprintProgress(giftContext),
    search: (queryOptions) => searchGifts(giftContext, queryOptions || {}),
    clearRecent: () => clearRecentGifts(giftContext),
    setActiveSource(source) {
      activeGiftSource = normalizeActiveGiftSource(source);
      return activeGiftSource;
    },
    getActiveSource: () => activeGiftSource,
  };
}

function normalizeActiveGiftSource(source) {
  if (!source || typeof source !== 'object') return null;
  const sourceId = Number(source.sourceId);
  return Object.freeze({
    sourceId:
      Number.isSafeInteger(sourceId) && sourceId >= 1 ? sourceId : null,
    syncState: String(source.syncState || 'OFFLINE').toUpperCase(),
    partial: source.partial !== false,
    syncedThroughCursor:
      source.syncedThroughCursor === null ||
      source.syncedThroughCursor === undefined
        ? null
        : Number(source.syncedThroughCursor),
    syncedAt: source.syncedAt || null,
    latestCursor:
      source.latestCursor === null || source.latestCursor === undefined
        ? null
        : Number(source.latestCursor),
    dirty: source.dirty !== false,
    epochValidated: source.epochValidated === true,
  });
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
  getGiftStatistics,
  getGiftSprintSnapshot,
  getBlindBoxAnalysis,
  getBlindBoxStats,
  searchGifts,
  normalizeGiftRow,
  normalizeGiftInput,
  clearRecentGifts,
};
