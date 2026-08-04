// 编写人：Aurora
// 礼物冲刺服务入口。
'use strict';

const {
  createGiftEventService,
  addGiftEvent,
  repairGiftV2Events
} = require('./event-service');
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
  const eventService = createGiftEventService(context, options);
  return {
    ...eventService,
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
  repairGiftV2Events,
  addGiftEvent,
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
