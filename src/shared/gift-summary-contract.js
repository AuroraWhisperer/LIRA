'use strict';

const { createHash } = require('node:crypto');
const DAY_MS = 86400000;
const METRIC_KEYS = Object.freeze([
  'eventCount', 'itemCount', 'totalPriceCents', 'guardEventCount', 'guardValueCents',
  'blindBoxEventCount', 'blindBoxUnknownCostEventCount', 'blindBoxPriceCents',
  'blindBoxValueCents', 'blindProfitCents', 'blindItemCount', 'unknownCostItemCount',
  'knownCostValueCents', 'unknownCostValueCents',
]);
const DIMENSION_KEYS = Object.freeze([
  'userName', 'giftId', 'giftName', 'unitPriceCents', 'coinType', 'isBlindBox',
  'giftVariantId', 'blindBoxId', 'blindBoxName', 'blindBoxVariantId', 'blindBoxUnitPriceCents',
]);

function invalid() { return Object.assign(new Error('INVALID_GIFT_SUMMARY'), { code: 'INVALID_RESPONSE', retryable: true }); }
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function dayStart(value) {
  const at = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(at)) throw invalid();
  return Math.floor((at + 8 * 3600000) / DAY_MS) * DAY_MS - 8 * 3600000;
}
function validateMetrics(metrics) {
  if (!exact(metrics, METRIC_KEYS) || !METRIC_KEYS.every((key) => Number.isSafeInteger(metrics[key]) &&
    (key === 'blindProfitCents' || metrics[key] >= 0)) ||
    metrics.eventCount > metrics.itemCount || metrics.blindBoxEventCount > metrics.eventCount ||
    metrics.guardEventCount + metrics.blindBoxEventCount > metrics.eventCount ||
    metrics.blindBoxUnknownCostEventCount > metrics.blindBoxEventCount ||
    metrics.unknownCostItemCount > metrics.blindItemCount || metrics.blindItemCount > metrics.itemCount ||
    metrics.knownCostValueCents + metrics.unknownCostValueCents !== metrics.blindBoxValueCents ||
    metrics.knownCostValueCents - metrics.blindBoxPriceCents !== metrics.blindProfitCents ||
    metrics.blindBoxValueCents + metrics.guardValueCents > metrics.totalPriceCents) throw invalid();
  return metrics;
}
function groupKey(dimensions) {
  return createHash('sha256').update(JSON.stringify(DIMENSION_KEYS.map((key) => dimensions[key]))).digest('hex');
}
function validateSummaryRow(row) {
  if (!exact(row, ['dayStart', 'groupKey', 'dimensions', 'metrics']) ||
    new Date(dayStart(row.dayStart)).toISOString() !== row.dayStart || !exact(row.dimensions, DIMENSION_KEYS)) throw invalid();
  const d = row.dimensions;
  for (const key of ['userName', 'giftId', 'giftName', 'coinType', 'blindBoxName'])
    if (typeof d[key] !== 'string' || d[key].length > 512) throw invalid();
  for (const key of ['giftVariantId', 'blindBoxId', 'blindBoxVariantId'])
    if (d[key] !== null && (typeof d[key] !== 'string' || !d[key] || d[key].length > 128)) throw invalid();
  if (!Number.isSafeInteger(d.unitPriceCents) || d.unitPriceCents < 0 || typeof d.isBlindBox !== 'boolean' ||
    (d.blindBoxUnitPriceCents !== null && (!Number.isSafeInteger(d.blindBoxUnitPriceCents) || d.blindBoxUnitPriceCents < 0)) ||
    groupKey(d) !== row.groupKey) throw invalid();
  validateMetrics(row.metrics);
  return structuredClone(row);
}
function normalizeGiftSummaryPage(page) {
  if (!exact(page, ['ok', 'giftRetentionVersion', 'syncEpoch', 'revision', 'baseRevision', 'summarizedBefore',
    'coveredThroughCursor', 'detailStart', 'rows', 'hasMore', 'nextPageToken', 'historyPageToken']) ||
    page.ok !== true || page.giftRetentionVersion !== 1 || typeof page.syncEpoch !== 'string' ||
    !page.syncEpoch || page.syncEpoch.length > 128 || typeof page.hasMore !== 'boolean' ||
    !Array.isArray(page.rows) || page.rows.length > 200) throw invalid();
  for (const key of ['revision', 'baseRevision', 'coveredThroughCursor'])
    if (!Number.isSafeInteger(page[key]) || page[key] < 0) throw invalid();
  if (page.baseRevision > page.revision) throw invalid();
  for (const key of ['detailStart', 'summarizedBefore'])
    if (page[key] !== null && new Date(dayStart(page[key])).toISOString() !== page[key]) throw invalid();
  for (const key of ['nextPageToken', 'historyPageToken'])
    if (page[key] !== null && (typeof page[key] !== 'string' || !page[key] || page[key].length > 4096)) throw invalid();
  if (!page.historyPageToken || page.hasMore !== (page.nextPageToken !== null)) throw invalid();
  const rows = page.rows.map(validateSummaryRow);
  if (rows.some((row) => page.summarizedBefore === null || row.dayStart >= page.summarizedBefore)) throw invalid();
  for (let i = 1; i < rows.length; i++)
    if (`${rows[i - 1].dayStart}:${rows[i - 1].groupKey}` >= `${rows[i].dayStart}:${rows[i].groupKey}`) throw invalid();
  return { ...page, rows };
}

module.exports = { DAY_MS, METRIC_KEYS, DIMENSION_KEYS, dayStart, groupKey, validateMetrics, validateSummaryRow, normalizeGiftSummaryPage };
