// 编写人：Aurora
// 礼物冲刺服务入口。
'use strict';
const { randomUUID } = require('node:crypto');

const { createGiftProjectionService } = require('./projection-service');
const { createGiftConsumerRegistry } = require('./consumer-registry');
const { createGiftStatisticsConsumer } = require('./statistics-consumer');
const {
  CRYSTAL_BALL_VALUE_RMB,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftSelection,
  getGiftViewRevision,
  getGiftStatistics,
  getGiftSprintSnapshot,
  searchGifts,
  clearRecentGifts,
} = require('./query-service');
const { getBlindBoxChangeToken, getBlindBoxStats, getBlindBoxAnalysis } = require('./blind-box-analysis');
const { normalizeGiftRow } = require('./normalizer');

function createGiftService({ queryStore, maintenanceStore, projectionStore, statisticsStore, settings, now }, options = {}) {
  let activeGiftSource = null;
  let viewEpoch = randomUUID();
  const giftContext = {
    queryStore,
    maintenanceStore,
    settings,
    now,
    getActiveGiftSource: () => activeGiftSource,
  };
  const statisticsConsumer =
    options.statisticsConsumer ||
    createGiftStatisticsConsumer({ store: statisticsStore });
  const consumerRegistry =
    options.consumerRegistry ||
    createGiftConsumerRegistry({
      consumers: [statisticsConsumer, ...(options.consumers || [])],
      onError: options.onConsumerError,
    });
  const projectionService = createGiftProjectionService({ store: projectionStore, settings }, {
    ...options,
    consumerRegistry,
  });
  return {
    ...projectionService,
    getSnapshot: () => getGiftSnapshot(giftContext),
    getHistory: (queryOptions) => getGiftHistory(giftContext, queryOptions),
    getSelection: (queryOptions) => getGiftSelection(giftContext, queryOptions),
    getViewRevision: () => getGiftViewRevision(giftContext),
    getStatistics: (queryOptions) => getGiftStatistics(giftContext, queryOptions),
    getSprintSnapshot: () => getGiftSprintSnapshot(giftContext),
    getBlindBoxChangeToken() {
      const token = getBlindBoxChangeToken(giftContext);
      return token === null ? null : JSON.stringify([viewEpoch, token]);
    },
    getBlindBoxStats: (queryOptions) => getBlindBoxStats(giftContext, queryOptions),
    getBlindBoxAnalysis: (queryOptions) => getBlindBoxAnalysis(giftContext, queryOptions),
    resetSprint: () => resetGiftSprintProgress(giftContext),
    search: (queryOptions) => searchGifts(giftContext, queryOptions || {}),
    clearRecent: () => clearRecentGifts(giftContext),
    setActiveSource(source) {
      if (
        source?.sourceId !== activeGiftSource?.sourceId ||
        (source?.syncState === 'SOURCE_SWITCHING' && activeGiftSource?.syncState !== 'SOURCE_SWITCHING')
      ) {
        viewEpoch = randomUUID();
      }
      activeGiftSource = normalizeActiveGiftSource(source);
      if (activeGiftSource) activeGiftSource = Object.freeze({ ...activeGiftSource, viewEpoch });
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
      source.syncedThroughCursor === null || source.syncedThroughCursor === undefined
        ? null
        : Number(source.syncedThroughCursor),
    syncedAt: source.syncedAt || null,
    latestCursor:
      source.latestCursor === null || source.latestCursor === undefined ? null : Number(source.latestCursor),
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
