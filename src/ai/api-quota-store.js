'use strict';

const { createAiApiUsageStore } = require('../storage/ai-api-usage-store');

const API_QUOTAS = Object.freeze({
  qweather: 40000,
  amap_search: 4000,
  amap_lbs: 120000,
});

const CATEGORY_TOOL_NAMES = Object.freeze({
  qweather: ['get_weather'],
  amap_search: ['search_places'],
  amap_lbs: ['resolve_location', 'get_route'],
});

const CATEGORY_ERROR_CODES = Object.freeze({
  qweather: 'QWEATHER_MONTHLY_LIMIT',
  amap_search: 'AMAP_SEARCH_MONTHLY_LIMIT',
  amap_lbs: 'AMAP_LBS_MONTHLY_LIMIT',
});

function createAiApiQuotaStore(db, options = {}) {
  const now = options.now || Date.now;
  const usageStore = createAiApiUsageStore(db);
  let lastPrunedMonth = '';

  function pruneOldMonths(monthKey) {
    if (monthKey === lastPrunedMonth) return;
    const [year, month] = monthKey.split('-').map(Number);
    const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    // 保留上月供跨月预留退款；保留未来月份，避免系统时钟回退重置用量。
    usageStore.pruneBefore(previousMonth);
    lastPrunedMonth = monthKey;
  }

  pruneOldMonths(getBeijingMonthKey(now()));

  function consume(category) {
    const limit = requireLimit(category);
    const timestamp = now();
    const monthKey = getBeijingMonthKey(timestamp);
    pruneOldMonths(monthKey);
    const count = usageStore.consume(category, monthKey, timestamp, limit);
    return { allowed: count !== null, category, monthKey, requestCount: count ?? limit, limit };
  }

  // 仅用于撤销未提交的预留；已经发起的请求不走退款路径。
  function release(category, monthKey = getBeijingMonthKey(now())) {
    const timestamp = now();
    usageStore.release(category, monthKey, timestamp);
  }

  function getUsage(category) {
    const limit = requireLimit(category);
    const monthKey = getBeijingMonthKey(now());
    pruneOldMonths(monthKey);
    return {
      category,
      monthKey,
      requestCount: usageStore.read(category, monthKey),
      limit,
    };
  }

  function getExcludedToolNames() {
    const excluded = [];
    for (const category of Object.keys(API_QUOTAS)) {
      const usage = getUsage(category);
      if (usage.requestCount >= usage.limit) excluded.push(...CATEGORY_TOOL_NAMES[category]);
    }
    return excluded;
  }

  function getAllUsage() {
    return Object.keys(API_QUOTAS).map(getUsage);
  }

  return { consume, release, getUsage, getAllUsage, getExcludedToolNames };
}

function requireApiQuota(quotaStore, category) {
  const reservation = reserveApiQuota(quotaStore, category);
  reservation.commit();
}

function releaseApiQuota(quotaStore, category, monthKey) {
  if (!quotaStore || typeof quotaStore.release !== 'function') return;
  quotaStore.release(category, monthKey);
}

function reserveApiQuota(quotaStore, category) {
  if (!quotaStore) return { commit() {}, release() {} };
  const usage = quotaStore.consume(category);
  if (!usage.allowed) {
    const error = new Error('本月第三方 API 安全用量已达到上限，请改用 web_search。');
    error.code = CATEGORY_ERROR_CODES[category];
    error.quotaCategory = category;
    throw error;
  }
  let active = true;
  return {
    commit() {
      active = false;
    },
    release() {
      if (!active) return;
      active = false;
      releaseApiQuota(quotaStore, category, usage.monthKey);
    },
  };
}

async function withApiQuota(quotaStore, category, operation) {
  const reservation = reserveApiQuota(quotaStore, category);
  // 安全用量限制请求尝试；失败或丢失响应不能恢复已使用的额度。
  reservation.commit();
  return operation(reservation);
}

function getQuotaToolNames(error) {
  return CATEGORY_TOOL_NAMES[error?.quotaCategory] || [];
}

function getBeijingMonthKey(timestamp) {
  return new Date(Number(timestamp) + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function requireLimit(category) {
  const limit = API_QUOTAS[category];
  if (!limit) throw new Error(`Unknown AI API quota category: ${category}`);
  return limit;
}

module.exports = {
  API_QUOTAS,
  createAiApiQuotaStore,
  requireApiQuota,
  releaseApiQuota,
  reserveApiQuota,
  withApiQuota,
  getQuotaToolNames,
  getBeijingMonthKey,
};
