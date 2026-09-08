'use strict';

const { normalizeGiftRow } = require('./normalizer');
const { now, normalizeMoney } = require('../../shared/utils');
const {
  canonicalGiftId,
  canonicalGiftText,
  canonicalCoinType,
} = require('../../shared/processed-gift-contract');
const {
  createGiftMaintenanceStore,
} = require('../../storage/gift-maintenance-store');
const { createGiftQueryStore } = require('../../storage/gift-query-store');
const { resolveGiftSourceScope } = require('./source-scope');

const CRYSTAL_BALL_VALUE_RMB = 100;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;
const MAX_SEARCH_LENGTH = 100;
const MAX_CURSOR_LENGTH = 4096;
const DEFAULT_HISTORY_SORT_FIELD = 'created_at';
const DEFAULT_HISTORY_SORT_DIRECTION = 'desc';
const HISTORY_SORT_FIELDS = Object.freeze([
  'created_at',
  'gift_name',
  'price',
  'remarks',
]);
const GIFT_METRIC_FIELDS = Object.freeze([
  'eventCount',
  'itemCount',
  'totalPriceCents',
  'blindBoxEventCount',
  'blindBoxUnknownCostEventCount',
  'blindBoxPriceCents',
  'blindBoxValueCents',
  'blindProfitCents',
]);
const GIFT_RANGES = Object.freeze({
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
});
function resetGiftSprintProgress(context) {
  const sourceScope = resolveGiftSourceScope(context);
  const changedCount = createGiftQueryStore(context.db.giftDb).resetSprint({
    sourceScope,
    updatedAt: now(),
  });
  return {
    reset: true,
    changedCount: Number(changedCount || 0),
    giftSprint: getGiftSprintSnapshot(context),
  };
}

function getGiftSnapshot(context) {
  const sourceScope = resolveGiftSourceScope(context);
  const recent = createGiftQueryStore(context.db.giftDb)
    .listRecent({ sourceScope, limit: 30 })
    .map(normalizeGiftRow);
  return { recent };
}

function getGiftHistory(context, options = {}) {
  const activeSource = requireActiveGiftSource(context);
  const query = normalizeLedgerQuery(options.query);
  const range = normalizeLedgerRange(options.range);
  const limit = normalizeHistoryLimit(options.limit);
  const sortField = normalizeHistorySortField(options.sortField);
  const sortDirection = normalizeHistorySortDirection(options.sortDirection);
  const cursor = decodeHistoryCursor(options.cursor, {
    query,
    range,
    sortField,
    sortDirection,
  });
  const asOf = cursor?.asOf || resolveAsOf(context);
  const queryStore = createGiftQueryStore(context.db.giftDb);
  const historyOptions = {
    sourceId: activeSource.sourceId,
    query,
    rangeStart: resolveRangeStart(range, asOf),
    asOf,
    cursor,
    sortField,
    sortDirection,
  };
  const total = queryStore.countHistory(historyOptions);
  const rows = queryStore.listHistory({
    ...historyOptions,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);

  return {
    asOf,
    range,
    items: pageRows.map(mapLedgerHistoryRow),
    nextCursor:
      hasMore && last
        ? encodeHistoryCursor({
            sortValue: last.history_sort_value,
            id: Number(last.id),
            asOf,
            query,
            range,
            sortField,
            sortDirection,
          })
        : null,
    hasMore,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    sortField,
    sortDirection,
    ...buildSyncMetadata(activeSource),
  };
}

function getGiftStatistics(context, options = {}) {
  const activeSource = requireActiveGiftSource(context);
  const query = normalizeLedgerQuery(options.query);
  const range = normalizeLedgerRange(options.range);
  const asOf = resolveAsOf(context);
  const { summaryRow, topRows, bucketRows } = createGiftQueryStore(
    context.db.giftDb,
  ).readStatistics({
    sourceId: activeSource.sourceId,
    query,
    rangeStart: resolveRangeStart(range, asOf),
    range,
    asOf,
  });

  return {
    asOf,
    range,
    timeZone: 'Asia/Shanghai',
    ...buildSyncMetadata(activeSource),
    summary: mapIntegerFields(summaryRow, GIFT_METRIC_FIELDS),
    topGifts: topRows.map((row) => ({
      giftId: canonicalGiftId(row.giftId),
      giftName: canonicalGiftText(row.giftName),
      ...mapIntegerFields(row, GIFT_METRIC_FIELDS),
    })),
    timeSeries: bucketRows.map((row) => ({
      bucketStart: String(row.bucketStart || ''),
      ...mapIntegerFields(row, GIFT_METRIC_FIELDS),
    })),
  };
}

function getGiftSprintSnapshot(context) {
  const settings = context.settings();
  const targetRmb = normalizeMoney(settings.giftSprintTargetRmb);
  const sourceScope = resolveGiftSourceScope(context);
  const row = createGiftQueryStore(context.db.giftDb).readSprint(sourceScope);
  const receivedRmb = normalizeMoney(row.receivedRmb);
  const remainingRmb = Math.max(0, normalizeMoney(targetRmb - receivedRmb));

  return {
    enabled: settings.enableGiftSprint === 'true',
    targetRmb,
    receivedRmb,
    remainingRmb,
    crystalBallValueRmb: CRYSTAL_BALL_VALUE_RMB,
    remainingCrystalBalls: Math.ceil(remainingRmb / CRYSTAL_BALL_VALUE_RMB),
    countedGiftCount: Number(row.countedGiftCount || 0),
  };
}

function searchGifts(context, { from, to, limit = 100 }) {
  const sourceScope = resolveGiftSourceScope(context);
  return createGiftQueryStore(context.db.giftDb)
    .search({ sourceScope, from, to, limit: Math.min(limit, 500) })
    .map(normalizeGiftRow);
}

function clearRecentGifts(context) {
  const giftDb = context.db.giftDb;
  const maintenance = createGiftMaintenanceStore(giftDb);
  const timestamp = now();

  // 使用维护存储协调删除，确保 pending settlements 被标记为 ignored
  const whereClause = `
    source_id IS NULL
    AND status = 'active' AND total_price > 0
    AND detection_status = 'final' AND gift_stats_eligible = 1
    AND id IN (
      SELECT id FROM gift_events
      WHERE source_id IS NULL
        AND status = 'active' AND total_price > 0
        AND detection_status = 'final' AND gift_stats_eligible = 1
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 3000
    )
  `.trim();

  const result = maintenance.deleteGiftsByPredicate(
    whereClause,
    [],
    'manual:clear-recent',
    timestamp,
  );

  return {
    cleared: true,
    scope: 'display-gifts',
    deletedCount: result.deletedGifts,
  };
}

function requireActiveGiftSource(context) {
  const source = context.getActiveGiftSource?.() || context.activeGiftSource;
  const sourceId = Number(source?.sourceId);
  if (
    !Number.isSafeInteger(sourceId) ||
    sourceId < 1 ||
    source?.syncState === 'SOURCE_SWITCHING'
  ) {
    throw createGiftQueryError(
      'GIFT_SOURCE_UNAVAILABLE',
      '当前礼物来源尚未就绪。',
    );
  }
  return Object.freeze({ ...source, sourceId });
}

function buildSyncMetadata(source) {
  const syncState = String(source.syncState || 'OFFLINE').toUpperCase();
  const complete =
    syncState === 'LIVE' &&
    source.partial === false &&
    source.dirty === false &&
    source.epochValidated === true;
  const cursor = Number(source.syncedThroughCursor);
  return {
    partial: !complete,
    syncState,
    syncedThroughCursor:
      Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null,
    syncedAt: normalizeOptionalIsoTimestamp(source.syncedAt),
  };
}

function mapLedgerHistoryRow(row) {
  const unitPriceCents = moneyToSafeCents(row.unit_price);
  const totalPriceCents = moneyToSafeCents(row.total_price);
  const isBlindBox = Number(row.is_blind_box) === 1;
  const blindBoxPriceCents =
    isBlindBox && row.blind_box_price !== null
      ? moneyToSafeCents(row.blind_box_price)
      : null;
  const blindProfitCents =
    blindBoxPriceCents === null
      ? null
      : totalPriceCents - blindBoxPriceCents;
  const platformId = String(row.platform_id || '');
  return {
    eventId: platformId.startsWith('lira-server:')
      ? platformId.slice('lira-server:'.length)
      : platformId,
    gift: {
      giftId: canonicalGiftId(row.gift_id),
      giftName: canonicalGiftText(row.gift_name),
      userName: canonicalGiftText(row.user_name) || '观众',
      num: toSafePositiveInteger(row.num),
      unitPrice: unitPriceCents / 100,
      totalPrice: totalPriceCents / 100,
      coinType: canonicalCoinType(row.coin_type),
      isBlindBox,
      blindBoxId: isBlindBox ? normalizeBlindBoxId(row.blind_box_id) : null,
      blindBoxName: isBlindBox
        ? canonicalGiftText(row.blind_box_name)
        : '',
      blindBoxPrice:
        blindBoxPriceCents === null ? null : blindBoxPriceCents / 100,
      blindProfit:
        blindProfitCents === null ? null : blindProfitCents / 100,
      createdAt: normalizeIsoTimestamp(row.created_at),
    },
  };
}

function normalizeBlindBoxId(value) {
  const id = String(value ?? '').trim();
  return /^[1-9]\d{0,19}$/u.test(id) ? id : null;
}

function normalizeLedgerQuery(value) {
  if (value === undefined || value === null) return '';
  const query = canonicalGiftText(value);
  if (!query || Array.from(query).length > MAX_SEARCH_LENGTH) {
    throw createGiftQueryError('INVALID_GIFT_QUERY', '礼物搜索内容过长。');
  }
  return query;
}

function normalizeLedgerRange(value) {
  const range = String(value || '30d');
  if (!Object.hasOwn(GIFT_RANGES, range)) {
    throw createGiftQueryError('INVALID_GIFT_RANGE', '礼物统计范围无效。');
  }
  return range;
}

function normalizeHistoryLimit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_HISTORY_LIMIT;
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw createGiftQueryError('INVALID_GIFT_LIMIT', '礼物分页大小无效。');
  }
  return limit;
}

function normalizeHistorySortField(value) {
  const sortField = String(value || DEFAULT_HISTORY_SORT_FIELD);
  if (!HISTORY_SORT_FIELDS.includes(sortField)) {
    throw createGiftQueryError(
      'INVALID_GIFT_SORT_FIELD',
      '礼物排序字段无效。',
    );
  }
  return sortField;
}

function normalizeHistorySortDirection(value) {
  const sortDirection = String(
    value || DEFAULT_HISTORY_SORT_DIRECTION,
  ).toLowerCase();
  if (sortDirection !== 'asc' && sortDirection !== 'desc') {
    throw createGiftQueryError(
      'INVALID_GIFT_SORT_DIRECTION',
      '礼物排序方向无效。',
    );
  }
  return sortDirection;
}

function resolveAsOf(context) {
  const value =
    typeof context.now === 'function' ? context.now() : new Date().toISOString();
  return normalizeIsoTimestamp(value);
}

function resolveRangeStart(range, asOf) {
  const days = GIFT_RANGES[range];
  if (days === null) return null;
  return new Date(Date.parse(asOf) - days * 24 * 60 * 60 * 1000).toISOString();
}

function encodeHistoryCursor(value) {
  const isDefaultSort =
    value.sortField === DEFAULT_HISTORY_SORT_FIELD &&
    value.sortDirection === DEFAULT_HISTORY_SORT_DIRECTION;
  const payload = isDefaultSort
    ? {
        version: 1,
        createdAt: normalizeIsoTimestamp(value.sortValue),
        id: value.id,
        asOf: value.asOf,
        query: value.query,
        range: value.range,
      }
    : {
        version: 2,
        sortField: value.sortField,
        sortDirection: value.sortDirection,
        sortValue: normalizeHistoryCursorSortValue(
          value.sortField,
          value.sortValue,
        ),
        id: value.id,
        asOf: value.asOf,
        query: value.query,
        range: value.range,
      };
  return Buffer.from(
    JSON.stringify(payload),
    'utf8',
  ).toString('base64url');
}

function decodeHistoryCursor(value, expected) {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    value.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw createGiftQueryError('INVALID_GIFT_CURSOR', '礼物分页游标无效。');
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const id = Number(parsed?.id);
    const asOf = normalizeIsoTimestamp(parsed?.asOf);
    const version = parsed?.version;
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      parsed?.query !== expected.query ||
      parsed?.range !== expected.range ||
      (version !== 1 && version !== 2)
    ) {
      throw new Error('invalid cursor');
    }
    if (version === 1) {
      if (
        expected.sortField !== DEFAULT_HISTORY_SORT_FIELD ||
        expected.sortDirection !== DEFAULT_HISTORY_SORT_DIRECTION
      ) {
        throw new Error('invalid cursor');
      }
      const createdAt = normalizeIsoTimestamp(parsed?.createdAt);
      if (createdAt >= asOf) throw new Error('invalid cursor');
      return Object.freeze({ id, sortValue: createdAt, asOf });
    }
    if (
      parsed?.sortField !== expected.sortField ||
      parsed?.sortDirection !== expected.sortDirection
    ) {
      throw new Error('invalid cursor');
    }
    const sortValue = normalizeHistoryCursorSortValue(
      expected.sortField,
      parsed?.sortValue,
    );
    if (expected.sortField === 'created_at' && sortValue >= asOf) {
      throw new Error('invalid cursor');
    }
    return Object.freeze({ id, sortValue, asOf });
  } catch (_) {
    throw createGiftQueryError('INVALID_GIFT_CURSOR', '礼物分页游标无效。');
  }
}

function normalizeHistoryCursorSortValue(sortField, value) {
  if (sortField === 'created_at') return normalizeIsoTimestamp(value);
  if (sortField === 'gift_name') return canonicalGiftText(value);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('invalid cursor');
  return number;
}

function mapIntegerFields(row, fields) {
  const mapped = {};
  for (const field of fields) {
    const value = Number(row?.[field] ?? 0);
    if (!Number.isSafeInteger(value)) {
      throw new Error('INVALID_GIFT_STATISTICS_AGGREGATE');
    }
    mapped[field] = value;
  }
  return mapped;
}

function moneyToSafeCents(value) {
  const amount = Number(value);
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(cents) ||
    Math.abs(scaled - cents) > 1e-7
  ) {
    throw new Error('INVALID_GIFT_MONEY');
  }
  return Object.is(cents, -0) ? 0 : cents;
}

function toSafePositiveInteger(value) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) {
    throw new Error('INVALID_GIFT_QUANTITY');
  }
  return integer;
}

function normalizeIsoTimestamp(value) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) throw new Error('INVALID_GIFT_TIMESTAMP');
  return new Date(milliseconds).toISOString();
}

function normalizeOptionalIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return normalizeIsoTimestamp(value);
  } catch (_) {
    return null;
  }
}

function createGiftQueryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  CRYSTAL_BALL_VALUE_RMB,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftStatistics,
  getGiftSprintSnapshot,
  searchGifts,
  clearRecentGifts,
  normalizeHistorySortField,
  normalizeHistorySortDirection,
};
