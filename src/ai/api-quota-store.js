'use strict';

const API_QUOTAS = Object.freeze({
  qweather: 40000,
  amap_search: 4000,
  amap_lbs: 120000
});

const CATEGORY_TOOL_NAMES = Object.freeze({
  qweather: ['get_weather'],
  amap_search: ['search_places'],
  amap_lbs: ['resolve_location', 'get_route']
});

const CATEGORY_ERROR_CODES = Object.freeze({
  qweather: 'QWEATHER_MONTHLY_LIMIT',
  amap_search: 'AMAP_SEARCH_MONTHLY_LIMIT',
  amap_lbs: 'AMAP_LBS_MONTHLY_LIMIT'
});

function createAiApiQuotaStore(db, options = {}) {
  const now = options.now || Date.now;
  const consumeStatement = db.prepare(`
    INSERT INTO ai_api_usage (category, month_key, request_count, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(category, month_key) DO UPDATE SET
      request_count = request_count + 1,
      updated_at = excluded.updated_at
    WHERE request_count < ?
    RETURNING request_count
  `);
  const readStatement = db.prepare(`
    SELECT request_count FROM ai_api_usage WHERE category = ? AND month_key = ?
  `);

  function consume(category) {
    const limit = requireLimit(category);
    const timestamp = now();
    const monthKey = getBeijingMonthKey(timestamp);
    const row = consumeStatement.get(category, monthKey, timestamp, limit);
    const requestCount = row ? Number(row.request_count) : limit;
    return { allowed: Boolean(row), category, monthKey, requestCount, limit };
  }

  function getUsage(category) {
    const limit = requireLimit(category);
    const monthKey = getBeijingMonthKey(now());
    const row = readStatement.get(category, monthKey);
    return { category, monthKey, requestCount: Number(row?.request_count) || 0, limit };
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

  return { consume, getUsage, getAllUsage, getExcludedToolNames };
}

function requireApiQuota(quotaStore, category) {
  if (!quotaStore) return;
  const usage = quotaStore.consume(category);
  if (usage.allowed) return;
  const error = new Error('本月第三方 API 安全用量已达到上限，请改用 web_search。');
  error.code = CATEGORY_ERROR_CODES[category];
  error.quotaCategory = category;
  throw error;
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
  getQuotaToolNames,
  getBeijingMonthKey
};
