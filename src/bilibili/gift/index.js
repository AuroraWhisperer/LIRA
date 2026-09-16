// 编写人：Aurora
// 礼物冲刺服务入口。
'use strict';

const {
  createGiftProjectionService: buildGiftProjectionService,
} = require('./projection-service');
const { createGiftConsumerRegistry } = require('./consumer-registry');
const {
  createGiftStatisticsConsumer: buildGiftStatisticsConsumer,
} = require('./statistics-consumer');
const {
  createGiftProjectionStore,
} = require('../../storage/gift-projection-store');
const {
  createGiftStatisticsStore,
} = require('../../storage/gift-statistics-store');
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
const { normalizeGiftRow } = require('./normalizer');

// Existing callers use this facade's database context. Keep that adaptation
// here; the projection and consumer implementations only receive narrow stores.
function createGiftProjectionService(context, options = {}) {
  return buildGiftProjectionService(
    {
      store:
        context.projectionStore || createGiftProjectionStore(context.db.giftDb),
      settings: context.settings,
    },
    options,
  );
}

function createGiftStatisticsConsumer({ store, giftDb }) {
  return buildGiftStatisticsConsumer({
    store: store || createGiftStatisticsStore(giftDb),
  });
}

function createGiftService(context, options = {}) {
  let activeGiftSource = null;
  const giftContext = {
    ...context,
    getActiveGiftSource: () => activeGiftSource,
  };
  const statisticsConsumer =
    options.statisticsConsumer ||
    createGiftStatisticsConsumer({
      store: context.statisticsStore,
      giftDb: context.db.giftDb,
    });
  const consumerRegistry =
    options.consumerRegistry ||
    createGiftConsumerRegistry({
      consumers: [statisticsConsumer, ...(options.consumers || [])],
      onError: options.onConsumerError,
    });
  const projectionService = createGiftProjectionService(giftContext, {
    ...options,
    consumerRegistry,
  });
  return {
    ...projectionService,
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
    sourceId: Number.isSafeInteger(sourceId) && sourceId >= 1 ? sourceId : null,
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
  createGiftProjectionService,
  createGiftConsumerRegistry,
  createGiftStatisticsConsumer,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftStatistics,
  getGiftSprintSnapshot,
  getBlindBoxAnalysis,
  getBlindBoxStats,
  searchGifts,
  normalizeGiftRow,
  clearRecentGifts,
};
