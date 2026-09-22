'use strict';

const { canonicalGiftId, canonicalGiftText } = require('../shared/processed-gift-contract');

const registeredGiftSqlFunctions = new WeakSet();
const historyCountCaches = new WeakMap();
const MAX_HISTORY_COUNTS = 64;
const MAX_TOP_GIFTS = 50;
const MAX_TIME_SERIES_POINTS = 240;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const GIFT_METRICS_SQL = `
  COUNT(*) AS eventCount,
  COALESCE(SUM(giftQuantity(g.num)), 0) AS itemCount,
  COALESCE(SUM(giftMoneyCents(g.total_price)), 0) AS totalPriceCents,
  COALESCE(SUM(CASE WHEN g.is_blind_box = 1 THEN 1 ELSE 0 END), 0)
    AS blindBoxEventCount,
  COALESCE(SUM(CASE
    WHEN g.is_blind_box = 1 AND g.blind_box_price IS NULL THEN 1
    ELSE 0
  END), 0) AS blindBoxUnknownCostEventCount,
  COALESCE(SUM(CASE
    WHEN g.is_blind_box = 1 AND g.blind_box_price IS NOT NULL
      THEN giftMoneyCents(g.blind_box_price)
    ELSE 0
  END), 0) AS blindBoxPriceCents,
  COALESCE(SUM(CASE
    WHEN g.is_blind_box = 1 THEN giftMoneyCents(g.total_price)
    ELSE 0
  END), 0) AS blindBoxValueCents,
  COALESCE(SUM(CASE
    WHEN g.is_blind_box = 1 AND g.blind_box_price IS NOT NULL
      THEN giftMoneyCents(g.total_price) - giftMoneyCents(g.blind_box_price)
    ELSE 0
  END), 0) AS blindProfitCents,
  MIN(giftMoneyCents(g.unit_price)) AS validatedUnitPriceCents
`;
const HISTORY_SORT_EXPRESSIONS = Object.freeze({
  created_at: 'g.created_at',
  gift_name: 'canonicalGiftText(g.gift_name)',
  price: 'giftMoneyCents(g.total_price)',
  remarks: `CASE
    WHEN canonicalGiftText(g.gift_name) LIKE '%总督%'
      OR canonicalGiftId(g.gift_id) = 'guard-1' THEN 300000
    WHEN canonicalGiftText(g.gift_name) LIKE '%提督%'
      OR canonicalGiftId(g.gift_id) = 'guard-2' THEN 200000
    WHEN canonicalGiftText(g.gift_name) LIKE '%舰长%'
      OR canonicalGiftId(g.gift_id) = 'guard-3' THEN 100000
    WHEN g.is_blind_box = 1 AND g.blind_box_price IS NOT NULL
      THEN giftMoneyCents(g.total_price) - giftMoneyCents(g.blind_box_price)
    WHEN g.is_blind_box = 1 THEN 0
    ELSE -99999900
  END`,
});

function createGiftQueryStore(giftDb) {
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create GiftQueryStore.');
  }
  ensureGiftSqlFunctions(giftDb);

  function resetSprint({ sourceScope, updatedAt }) {
    const scope = normalizeSourceScope(sourceScope);
    return giftDb
      .prepare(
        `
        UPDATE gift_events SET counted_in_sprint = 0, updated_at = ?
        WHERE counted_in_sprint = 1
          AND ${scope.sql}
      `,
      )
      .run(updatedAt, ...scope.params).changes;
  }

  function listRecent({ sourceScope, limit }) {
    const scope = normalizeSourceScope(sourceScope);
    return giftDb
      .prepare(
        `
        SELECT * FROM gift_events
        WHERE status = 'active' AND total_price > 0
          AND detection_status = 'final' AND gift_stats_eligible = 1
          AND ${scope.sql}
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      `,
      )
      .all(...scope.params, limit);
  }

  function listHistoryRows({
    sourceId,
    eventIds,
    query,
    rangeStart,
    rangeEnd,
    userQuery,
    giftQuery,
    amountAbove,
    asOf,
    cursor,
    limit,
    sortField = 'created_at',
    sortDirection = 'desc',
  }) {
    const sort = normalizeHistorySort(sortField, sortDirection);
    const filterOptions = {
      sourceId,
      eventIds,
      query,
      rangeStart,
      rangeEnd,
      userQuery,
      giftQuery,
      amountAbove,
      asOf,
      cursor: sort.field === 'created_at' ? null : cursor,
      sortField: sort.field,
      sortDirection: sort.direction,
    };
    const filter = buildLedgerFilter(filterOptions);
    if (cursor && sort.field === 'created_at') {
      const sameTime = giftDb
        .prepare(
          `
        SELECT g.*, g.created_at AS history_sort_value
        FROM gift_events g
        WHERE ${filter.sql} AND g.created_at = ? AND g.id < ?
        ORDER BY g.id DESC LIMIT ?
      `,
        )
        .all(...filter.params, cursor.sortValue, cursor.id, limit);
      if (sameTime.length === limit) return sameTime;
      const nextFilter = buildLedgerFilter({ ...filterOptions, timeCursor: cursor });
      const remaining = giftDb
        .prepare(
          `
        SELECT g.*, g.created_at AS history_sort_value
        FROM gift_events g
        WHERE ${nextFilter.sql}
        ORDER BY g.created_at ${sort.sqlDirection}, g.id DESC LIMIT ?
      `,
        )
        .all(...nextFilter.params, limit - sameTime.length);
      return [...sameTime, ...remaining];
    }
    return giftDb
      .prepare(
        `
        SELECT g.*, ${sort.expression} AS history_sort_value
        FROM gift_events g
        WHERE ${filter.sql}
        ORDER BY ${sort.expression} ${sort.sqlDirection}, g.id DESC
        LIMIT ?
      `,
      )
      .all(...filter.params, limit);
  }

  function countHistory({
    sourceId,
    query,
    rangeStart,
    rangeEnd,
    userQuery,
    giftQuery,
    amountAbove,
    asOf,
    sortField = 'created_at',
    sortDirection = 'desc',
  }) {
    const sort = normalizeHistorySort(sortField, sortDirection);
    const filter = buildLedgerFilter({
      sourceId,
      query,
      rangeStart,
      rangeEnd,
      userQuery,
      giftQuery,
      amountAbove,
      asOf,
      sortField: sort.field,
      sortDirection: sort.direction,
    });
    const row = giftDb
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM gift_events g
        WHERE ${filter.sql}
      `,
      )
      .get(...filter.params);
    return Number(row?.count || 0);
  }

  function readHistoryPage(options) {
    let nextCache;
    const page = withReadTransaction(giftDb, () => {
      // Read the version inside the same snapshot as COUNT and both page segments.
      // total_changes covers this connection (including rolled-back writes), while
      // data_version covers commits from other connections. asOf alone is not a snapshot.
      const schemaVersion = giftDb.prepare('PRAGMA schema_version').get().schema_version;
      const changes = giftDb.prepare('SELECT total_changes() AS value').get().value;
      const dataVersion = giftDb.prepare('PRAGMA data_version').get().data_version;
      const stamp = `${changes}:${dataVersion}:${schemaVersion}`;
      const previous = historyCountCaches.get(giftDb);
      const counts = previous?.stamp === stamp ? new Map(previous.counts) : new Map();
      const filter = buildLedgerFilter({ ...options, cursor: null });
      const key = JSON.stringify([filter.sql, filter.params]);
      const total = counts.has(key) ? counts.get(key) : countHistory(options);
      counts.delete(key);
      counts.set(key, total);
      if (counts.size > MAX_HISTORY_COUNTS) counts.delete(counts.keys().next().value);
      nextCache = { stamp, counts };
      return { total, rows: listHistoryRows(options) };
    });
    // A failed read transaction must never publish a cached count.
    historyCountCaches.set(giftDb, nextCache);
    return page;
  }

  function readStatistics({ sourceId, query, rangeStart, asOf, range }) {
    const filter = buildLedgerFilter({
      sourceId,
      query,
      rangeStart,
      asOf,
    });
    return withReadTransaction(giftDb, () => {
      const summaryRow = giftDb
        .prepare(
          `
          SELECT
            ${GIFT_METRICS_SQL}
          FROM gift_events g
          WHERE ${filter.sql}
        `,
        )
        .get(...filter.params);
      const topRows = giftDb
        .prepare(
          `
          SELECT
            canonicalGiftId(g.gift_id) AS giftId,
            canonicalGiftText(g.gift_name) AS giftName,
            ${GIFT_METRICS_SQL}
          FROM gift_events g
          WHERE ${filter.sql}
          GROUP BY canonicalGiftId(g.gift_id), canonicalGiftText(g.gift_name)
        `,
        )
        .all(...filter.params)
        .sort(compareTopGifts)
        .slice(0, MAX_TOP_GIFTS);
      const bucketExpression =
        range === 'all'
          ? "strftime('%Y-%m', g.created_at, '+8 hours')"
          : "strftime('%Y-%m-%d', g.created_at, '+8 hours')";
      const bucketRows = giftDb
        .prepare(
          `
          SELECT
            ${bucketExpression} AS bucketKey,
            ${GIFT_METRICS_SQL}
          FROM gift_events g
          WHERE ${filter.sql}
          GROUP BY bucketKey
          ORDER BY bucketKey ASC
        `,
        )
        .all(...filter.params)
        .slice(-MAX_TIME_SERIES_POINTS)
        .map(({ bucketKey, ...row }) => ({
          bucketStart: shanghaiBucketStart(bucketKey),
          ...row,
        }));
      return { summaryRow, topRows, bucketRows };
    });
  }

  function readSprint(sourceScope) {
    const scope = normalizeSourceScope(sourceScope);
    return (
      giftDb
        .prepare(
          `
          SELECT
            COALESCE(SUM(total_price), 0) AS receivedRmb,
            COUNT(*) AS countedGiftCount
          FROM gift_events
          WHERE status = 'active' AND counted_in_sprint = 1
            AND detection_status = 'final' AND gift_stats_eligible = 1
            AND ${scope.sql}
        `,
        )
        .get(...scope.params) || {}
    );
  }

  function search({ sourceScope, from, to, limit }) {
    const scope = normalizeSourceScope(sourceScope);
    let sql = `
      SELECT * FROM gift_events
      WHERE status = 'active' AND total_price > 0
        AND detection_status = 'final' AND gift_stats_eligible = 1
        AND ${scope.sql}
    `;
    const params = [...scope.params];
    if (from) {
      sql += ' AND created_at >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND created_at <= ?';
      params.push(to);
    }
    sql += ' ORDER BY datetime(created_at) DESC, id DESC LIMIT ?';
    params.push(limit);
    return giftDb.prepare(sql).all(...params);
  }

  function listBlindBoxRows({ sourceScope, from, to, boxName }) {
    const scope = normalizeSourceScope(sourceScope);
    const params = [from, to, ...scope.params];
    let sql = `
      SELECT id, gift_name, user_name, uid, blind_box_name, blind_box_price,
             total_price, blind_profit, num, created_at
      FROM gift_events
      WHERE status = 'active'
        AND detection_status = 'final'
        AND gift_stats_eligible = 1
        AND is_blind_box = 1
        AND blind_profit IS NOT NULL
        AND created_at >= ?
        AND created_at < ?
        AND ${scope.sql}
    `;
    if (boxName) {
      sql += ' AND blind_box_name = ?';
      params.push(boxName);
    }
    sql += ' ORDER BY datetime(created_at) DESC, id DESC';
    return giftDb.prepare(sql).all(...params);
  }

  return {
    listBlindBoxRows,
    readHistorySnapshot: (options) => withReadTransaction(giftDb, () => listHistoryRows(options)),
    readHistoryPage,
    getProjectionGeneration: (sourceId) =>
      Number(
        giftDb.prepare('SELECT projection_generation FROM gift_sync_state WHERE source_id = ?').get(sourceId)
          ?.projection_generation || 0,
      ),
    resetSprint,
    listRecent,
    listHistory: (options) => withReadTransaction(giftDb, () => listHistoryRows(options)),
    countHistory,
    readStatistics,
    readSprint,
    search,
  };
}

function normalizeSourceScope(sourceScope) {
  if (sourceScope?.kind === 'local') {
    return { sql: 'source_id IS NULL', params: [] };
  }
  if (sourceScope?.kind === 'source' && Number.isSafeInteger(sourceScope.sourceId) && sourceScope.sourceId >= 1) {
    return { sql: 'source_id = ?', params: [sourceScope.sourceId] };
  }
  return { sql: '1 = 0', params: [] };
}

function normalizeHistorySort(sortField, sortDirection) {
  const field = String(sortField || 'created_at');
  if (!Object.hasOwn(HISTORY_SORT_EXPRESSIONS, field)) {
    throw new Error('INVALID_GIFT_SORT_FIELD');
  }
  const direction = String(sortDirection || 'desc').toLowerCase();
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error('INVALID_GIFT_SORT_DIRECTION');
  }
  return {
    field,
    direction,
    expression: HISTORY_SORT_EXPRESSIONS[field],
    sqlDirection: direction.toUpperCase(),
  };
}

function buildLedgerFilter({
  sourceId,
  eventIds,
  query,
  rangeStart,
  rangeEnd,
  userQuery,
  giftQuery,
  amountAbove,
  asOf,
  cursor = null,
  timeCursor = null,
  sortField = 'created_at',
  sortDirection = 'desc',
}) {
  const sort = normalizeHistorySort(sortField, sortDirection);
  // One bound per direction: duplicate upper bounds can make SQLite start at
  // asOf instead of the deeper cursor, even when EXPLAIN reports an index search.
  let upperBound = rangeEnd && rangeEnd < asOf ? rangeEnd : asOf;
  let lowerBound = rangeStart;
  let lowerExclusive = false;
  if (timeCursor) {
    if (sort.direction === 'desc') {
      if (timeCursor.sortValue < upperBound) upperBound = timeCursor.sortValue;
    } else if (!lowerBound || timeCursor.sortValue >= lowerBound) {
      lowerBound = timeCursor.sortValue;
      lowerExclusive = true;
    }
  }
  const sql = [
    'g.source_id = ?',
    "g.detection_status = 'final'",
    "g.status = 'active'",
    'g.total_price > 0',
    'g.num >= 1',
    "(canonicalGiftText(g.gift_id) <> '' OR canonicalGiftText(g.gift_name) <> '')",
    'datetime(g.created_at) IS NOT NULL',
    'g.created_at < ?',
  ];
  const params = [sourceId, upperBound];
  if (amountAbove !== undefined && amountAbove !== null) {
    sql.push('giftMoneyCents(g.total_price) > ?');
    params.push(Math.round(amountAbove * 100));
  }
  if (eventIds) {
    sql.push("g.platform_id IN (SELECT 'lira-server:' || value FROM json_each(?))");
    params.push(JSON.stringify(eventIds));
  }
  for (const [column, value] of [
    ['user_name', userQuery],
    ['gift_name', giftQuery],
  ]) {
    if (!value) continue;
    sql.push(`instr(canonicalGiftText(g.${column}), ?) > 0`);
    params.push(value);
  }
  if (lowerBound) {
    sql.push(`g.created_at ${lowerExclusive ? '>' : '>='} ?`);
    params.push(lowerBound);
  }
  if (query) {
    sql.push('(instr(canonicalGiftText(g.gift_name), ?) > 0 OR instr(canonicalGiftText(g.blind_box_name), ?) > 0)');
    params.push(query, query);
  }
  if (cursor) {
    const operator = sort.direction === 'asc' ? '>' : '<';
    sql.push(`(${sort.expression} ${operator} ? OR (${sort.expression} = ? AND g.id < ?))`);
    params.push(cursor.sortValue, cursor.sortValue, cursor.id);
  }
  return { sql: sql.join('\n          AND '), params };
}

function ensureGiftSqlFunctions(giftDb) {
  if (registeredGiftSqlFunctions.has(giftDb)) return;
  giftDb.function('canonicalGiftId', { deterministic: true }, canonicalGiftId);
  giftDb.function('canonicalGiftText', { deterministic: true }, canonicalGiftText);
  giftDb.function('giftMoneyCents', { deterministic: true }, giftMoneyCents);
  giftDb.function('giftQuantity', { deterministic: true }, giftQuantity);
  registeredGiftSqlFunctions.add(giftDb);
}

function giftMoneyCents(value) {
  const amount = value;
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isSafeInteger(cents) ||
    Math.abs(scaled - cents) > 1e-7
  ) {
    throw new Error('INVALID_GIFT_MONEY');
  }
  return Object.is(cents, -0) ? 0 : cents;
}

function giftQuantity(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('INVALID_GIFT_QUANTITY');
  }
  return value;
}

function compareTopGifts(left, right) {
  return (
    right.totalPriceCents - left.totalPriceCents ||
    compareText(left.giftName, right.giftName) ||
    compareText(left.giftId, right.giftId)
  );
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function shanghaiBucketStart(bucketKey) {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u.exec(String(bucketKey || ''));
  if (!match) throw new Error('INVALID_GIFT_TIMESTAMP');
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3] || 1);
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS).toISOString();
}

function withReadTransaction(db, operation) {
  db.exec('BEGIN');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { createGiftQueryStore };
