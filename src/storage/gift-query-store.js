'use strict';

const {
  canonicalGiftId,
  canonicalGiftText,
} = require('../shared/processed-gift-contract');

const registeredGiftSqlFunctions = new WeakSet();
const MAX_TOP_GIFTS = 50;
const MAX_TIME_SERIES_POINTS = 240;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const ALLOWED_SOURCE_SCOPES = new Set([
  'source_id IS NULL',
  'source_id = ?',
  '1 = 0',
]);
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

  function listHistory({
    sourceId,
    query,
    rangeStart,
    asOf,
    cursor,
    limit,
  }) {
    const filter = buildLedgerFilter({
      sourceId,
      query,
      rangeStart,
      asOf,
      cursor,
    });
    return giftDb
      .prepare(
        `
        SELECT g.*
        FROM gift_events g
        WHERE ${filter.sql}
        ORDER BY g.created_at DESC, g.id DESC
        LIMIT ?
      `,
      )
      .all(...filter.params, limit);
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

  return {
    resetSprint,
    listRecent,
    listHistory,
    readStatistics,
    readSprint,
    search,
  };
}

function normalizeSourceScope(sourceScope) {
  const sql = String(sourceScope?.sql || '1 = 0');
  const params = Array.isArray(sourceScope?.params)
    ? [...sourceScope.params]
    : [];
  if (!ALLOWED_SOURCE_SCOPES.has(sql)) {
    throw new Error('INVALID_GIFT_SOURCE_SCOPE');
  }
  if (
    (sql === 'source_id = ?' && params.length !== 1) ||
    (sql !== 'source_id = ?' && params.length !== 0)
  ) {
    throw new Error('INVALID_GIFT_SOURCE_SCOPE');
  }
  return { sql, params };
}

function buildLedgerFilter({ sourceId, query, rangeStart, asOf, cursor = null }) {
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
  const params = [sourceId, asOf];
  if (rangeStart) {
    sql.push('g.created_at >= ?');
    params.push(rangeStart);
  }
  if (query) {
    sql.push(
      '(instr(canonicalGiftText(g.gift_name), ?) > 0 OR instr(canonicalGiftText(g.blind_box_name), ?) > 0)',
    );
    params.push(query, query);
  }
  if (cursor) {
    sql.push('(g.created_at < ? OR (g.created_at = ? AND g.id < ?))');
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  return { sql: sql.join('\n          AND '), params };
}

function ensureGiftSqlFunctions(giftDb) {
  if (registeredGiftSqlFunctions.has(giftDb)) return;
  giftDb.function('canonicalGiftId', { deterministic: true }, canonicalGiftId);
  giftDb.function(
    'canonicalGiftText',
    { deterministic: true },
    canonicalGiftText,
  );
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
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u.exec(
    String(bucketKey || ''),
  );
  if (!match) throw new Error('INVALID_GIFT_TIMESTAMP');
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3] || 1);
  return new Date(
    Date.UTC(year, month, day, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS,
  ).toISOString();
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
