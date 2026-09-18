'use strict';

const { createHash } = require('node:crypto');
const { canonicalGiftText } = require('../../shared/processed-gift-contract');

function queryError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeHistoryFilters(options = {}) {
  const filters = {};
  for (const key of ['startDate', 'endDate']) {
    const value = options[key] || '';
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
      throw queryError('INVALID_GIFT_FILTER', '请输入有效的日期。');
    }
    filters[key] = value;
  }
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    throw queryError('INVALID_GIFT_FILTER', '开始日期不能晚于结束日期。');
  }
  for (const key of ['userQuery', 'giftQuery']) {
    filters[key] = canonicalGiftText(options[key] || '');
    if (Array.from(filters[key]).length > 100) {
      throw queryError('INVALID_GIFT_FILTER', '名称关键词不能超过 100 个字。');
    }
  }
  return filters;
}

function shanghaiDayStart(date) {
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

function historyBounds(filters, rangeStart, asOf) {
  const start = filters.startDate ? shanghaiDayStart(filters.startDate) : null;
  const end = filters.endDate
    ? new Date(Date.parse(shanghaiDayStart(filters.endDate)) + 86400000).toISOString()
    : null;
  return {
    rangeStart: start && (!rangeStart || start > rangeStart) ? start : rangeStart,
    rangeEnd: end && end < asOf ? end : asOf,
  };
}

function giftViewRevision(source, generation) {
  return createHash('sha256').update(JSON.stringify([
    source.sourceId, generation, source.viewEpoch || '',
  ])).digest('hex').slice(0, 32);
}

module.exports = { normalizeHistoryFilters, shanghaiDayStart, historyBounds, giftViewRevision, queryError };
