// 编写人：Aurora
// 礼物删除与加班机结算协调存储层。
// 确保删除礼物时同步处理关联的 overtime_settlements，防止孤儿记录。
'use strict';

/**
 * 创建礼物维护存储，提供协调的礼物删除操作。
 * 所有礼物删除路径（手动清空、保留期清理、近期礼物清理）统一使用本模块，
 * 保证删除前将 pending settlements 标记为 ignored，保留 applied/ignored 审计记录。
 */
function createGiftMaintenanceStore(giftDb) {
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create GiftMaintenanceStore.');
  }

  /**
   * 通过礼物事件 ID 列表协调删除礼物及其结算记录。
   *
   * @param {number[]} giftEventIds - 待删除的礼物事件 ID 数组
   * @param {string} reason - 删除原因，用于审计跟踪
   * @param {string} updatedAt - 更新时间戳 (ISO 8601)
   * @returns {{ deletedGifts: number, ignoredSettlements: number }}
   */
  function deleteGiftsWithSettlements(giftEventIds, reason, updatedAt) {
    if (!Array.isArray(giftEventIds) || giftEventIds.length === 0) {
      return { deletedGifts: 0, ignoredSettlements: 0 };
    }

    const placeholders = giftEventIds.map(() => '?').join(',');

    giftDb.exec('BEGIN IMMEDIATE');
    try {
      // 第一步：将待删除礼物的 pending settlements 标记为 ignored
      const pendingCount = giftDb.prepare(`
        UPDATE overtime_settlements
        SET status = 'ignored', rule_mode = 'ignored', settle_after_ms = 0,
            last_error = ?, updated_at = ?
        WHERE gift_event_id IN (${placeholders})
          AND status = 'pending'
      `).run(reason, updatedAt, ...giftEventIds).changes;

      // 第二步：保留 applied/ignored 结算记录（不删除，用于审计）
      // 无需操作 - 已完成的结算会自然保留

      // 第三步：删除礼物事件本身
      const deletedCount = giftDb.prepare(`
        DELETE FROM gift_events WHERE id IN (${placeholders})
      `).run(...giftEventIds).changes;

      giftDb.exec('COMMIT');
      return { deletedGifts: deletedCount, ignoredSettlements: pendingCount };
    } catch (error) {
      giftDb.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 按条件协调删除礼物。适用于保留期清理、近期礼物清空等场景。
   *
   * @param {string} whereClause - WHERE 子句（不含 WHERE 关键字）
   * @param {any[]} params - WHERE 子句参数
   * @param {string} reason - 删除原因
   * @param {string} updatedAt - 更新时间戳
   * @returns {{ deletedGifts: number, ignoredSettlements: number }}
   */
  function deleteGiftsByPredicate(whereClause, params, reason, updatedAt) {
    if (!whereClause) {
      throw new Error('whereClause is required for predicate-based deletion.');
    }

    // 先查找符合条件的礼物 ID
    const ids = giftDb.prepare(
      `SELECT id FROM gift_events WHERE ${whereClause}`
    ).all(...params).map(row => Number(row.id));

    // 委托给 ID 删除方法
    return ids.length > 0
      ? deleteGiftsWithSettlements(ids, reason, updatedAt)
      : { deletedGifts: 0, ignoredSettlements: 0 };
  }

  /**
   * 统计符合条件的礼物数量（用于 dry-run 场景）。
   *
   * @param {string} whereClause - WHERE 子句
   * @param {any[]} params - WHERE 子句参数
   * @returns {number}
   */
  function countGiftsByPredicate(whereClause, params) {
    if (!whereClause) return 0;

    const result = giftDb.prepare(
      `SELECT COUNT(*) AS count FROM gift_events WHERE ${whereClause}`
    ).get(...params);

    return Number(result?.count) || 0;
  }

  return {
    deleteGiftsWithSettlements,
    deleteGiftsByPredicate,
    countGiftsByPredicate
  };
}

module.exports = { createGiftMaintenanceStore };
