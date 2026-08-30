'use strict';

const { normalizeGiftRow } = require('./normalizer');
const { now, normalizeMoney } = require('../../shared/utils');
const {
  createGiftMaintenanceStore,
} = require('../../storage/gift-maintenance-store');

const CRYSTAL_BALL_VALUE_RMB = 100;

function resetGiftSprintProgress(context) {
  const giftDb = context.db.giftDb;
  const result = giftDb
    .prepare(
      `
    UPDATE gift_events SET counted_in_sprint = 0, updated_at = ?
    WHERE counted_in_sprint = 1
  `,
    )
    .run(now());
  return {
    reset: true,
    changedCount: Number(result.changes || 0),
    giftSprint: getGiftSprintSnapshot(context),
  };
}

function getGiftSnapshot(context) {
  const recent = context.db.giftDb
    .prepare(
      `
    SELECT * FROM gift_events
    WHERE status = 'active' AND total_price > 0
      AND detection_status = 'final' AND gift_stats_eligible = 1
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 30
  `,
    )
    .all()
    .map(normalizeGiftRow);
  return { recent };
}

function getGiftHistory(context, options = {}) {
  const giftDb = context.db.giftDb;
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(options.limit) || 50)),
  );
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const sortField = String(options.sortField || 'created_at');
  const sortDirection =
    String(options.sortDirection || 'desc').toLowerCase() === 'asc'
      ? 'ASC'
      : 'DESC';

  let orderByClause = '';
  switch (sortField) {
    case 'gift_name':
      orderByClause = `gift_name ${sortDirection}, id DESC`;
      break;
    case 'price':
      orderByClause = `total_price ${sortDirection}, id DESC`;
      break;
    case 'remarks':
      orderByClause = `
        CASE
          WHEN gift_name LIKE '%总督%' OR gift_id = 'guard-1' THEN 3000
          WHEN gift_name LIKE '%提督%' OR gift_id = 'guard-2' THEN 2000
          WHEN gift_name LIKE '%舰长%' OR gift_id = 'guard-3' THEN 1000
          WHEN is_blind_box = 1 THEN COALESCE(blind_profit, 0)
          ELSE -999999
        END ${sortDirection}, id DESC`;
      break;
    case 'created_at':
    default:
      orderByClause = `datetime(created_at) ${sortDirection}, id DESC`;
      break;
  }

  const displayLimitIds = giftDb
    .prepare(
      `
    SELECT id FROM gift_events
    WHERE status = 'active' AND total_price > 0
      AND detection_status = 'final' AND gift_stats_eligible = 1
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 3000
  `,
    )
    .all()
    .map((row) => row.id);

  if (displayLimitIds.length === 0) {
    return { items: [], total: 0, page: 1, limit, totalPages: 1 };
  }

  const minId = Math.min(...displayLimitIds);
  const maxId = Math.max(...displayLimitIds);
  const totalRow =
    giftDb
      .prepare(
        `
    SELECT COUNT(*) AS count
    FROM gift_events
    WHERE status = 'active' AND total_price > 0
      AND detection_status = 'final' AND gift_stats_eligible = 1
      AND id >= ? AND id <= ?
  `,
      )
      .get(minId, maxId) || {};
  const total = Number(totalRow.count || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const items = giftDb
    .prepare(
      `
    SELECT * FROM gift_events
    WHERE status = 'active' AND total_price > 0
      AND detection_status = 'final' AND gift_stats_eligible = 1
      AND id >= ? AND id <= ?
    ORDER BY ${orderByClause}
    LIMIT ? OFFSET ?
  `,
    )
    .all(minId, maxId, limit, (safePage - 1) * limit)
    .map(normalizeGiftRow);

  return { items, total, page: safePage, limit, totalPages };
}

function getGiftSprintSnapshot(context) {
  const settings = context.settings();
  const targetRmb = normalizeMoney(settings.giftSprintTargetRmb);
  const row =
    context.db.giftDb
      .prepare(
        `
    SELECT
      COALESCE(SUM(total_price), 0) AS receivedRmb,
      COUNT(*) AS countedGiftCount
    FROM gift_events
    WHERE status = 'active' AND counted_in_sprint = 1
      AND detection_status = 'final' AND gift_stats_eligible = 1
  `,
      )
      .get() || {};
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
  const giftDb = context.db.giftDb;
  let sql = `
    SELECT * FROM gift_events
    WHERE status = 'active' AND total_price > 0
      AND detection_status = 'final' AND gift_stats_eligible = 1
  `;
  const params = [];
  if (from) {
    sql += ` AND created_at >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND created_at <= ?`;
    params.push(to);
  }
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`;
  params.push(Math.min(limit, 500));
  return giftDb
    .prepare(sql)
    .all(...params)
    .map(normalizeGiftRow);
}

function clearRecentGifts(context) {
  const giftDb = context.db.giftDb;
  const maintenance = createGiftMaintenanceStore(giftDb);
  const timestamp = now();

  // 使用维护存储协调删除，确保 pending settlements 被标记为 ignored
  const whereClause = `
    status = 'active' AND total_price > 0
    AND detection_status = 'final' AND gift_stats_eligible = 1
    AND id IN (
      SELECT id FROM gift_events
      WHERE status = 'active' AND total_price > 0
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

module.exports = {
  CRYSTAL_BALL_VALUE_RMB,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftSprintSnapshot,
  searchGifts,
  clearRecentGifts,
};
