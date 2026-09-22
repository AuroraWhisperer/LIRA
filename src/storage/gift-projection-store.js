'use strict';

function createGiftProjectionStore(giftDb) {
  if (!giftDb || typeof giftDb.prepare !== 'function')
    throw new Error('giftDb is required to create GiftProjectionStore.');
  return {
    hasSource: (id) => Boolean(giftDb.prepare('SELECT 1 FROM gift_sources WHERE id = ?').get(id)),
    read: (id) => readGift(giftDb, id),
    findEvent(sourceId, platformId, command) {
      const row = giftDb
        .prepare(
          `SELECT * FROM gift_events
        WHERE source_id = ? AND platform_id = ? AND cmd = ? ORDER BY id ASC LIMIT 1`,
        )
        .get(sourceId, platformId, command);
      return row ? { ...row } : null;
    },
    insertProgress: (gift, eligibility) => insertProgressGift(giftDb, gift, eligibility),
    updateProgress: (id, sourceId, gift, detectedAtMs) => updateProcessedGift(giftDb, id, sourceId, gift, detectedAtMs),
    insertHistory({ gift, sourceId, platformId, command }) {
      const createdAtMs = Date.parse(gift.createdAt);
      const result = giftDb
        .prepare(
          `
        INSERT INTO gift_events (
          source_id, platform_id, cmd, gift_id, gift_name,
          uid, user_name, num, unit_price, total_price, coin_type,
          is_blind_box, blind_box_id, blind_box_name, blind_box_price, blind_profit,
          gift_variant_id, blind_box_variant_id, avatar_url, guard_level,
          counted_in_sprint, detection_status,
          first_detected_at_ms, last_platform_at_ms, finalized_at_ms,
          gift_stats_eligible, gift_stats_delivered, overtime_epoch,
          status, raw_json, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          0, 'final', ?, ?, ?, 0, 1, 0, 'active', '', ?, ?
        )
      `,
        )
        .run(
          sourceId,
          platformId,
          command,
          gift.giftId,
          gift.giftName,
          gift.userName,
          gift.num,
          gift.unitPrice,
          gift.totalPrice,
          gift.coinType,
          gift.isBlindBox ? 1 : 0,
          gift.blindBoxId,
          gift.blindBoxName,
          gift.blindBoxPrice,
          gift.blindProfit,
          gift.giftVariantId,
          gift.blindBoxVariantId,
          gift.display?.avatarUrl ?? null,
          gift.display?.guardLevel ?? null,
          createdAtMs,
          createdAtMs,
          createdAtMs,
          gift.createdAt,
          gift.createdAt,
        );
      return readGift(giftDb, result.lastInsertRowid);
    },
    markFinal(id, finalizedAtMs) {
      const result = giftDb
        .prepare(
          `UPDATE gift_events
        SET detection_status = 'final', finalized_at_ms = ?
        WHERE id = ? AND detection_status = 'progress'`,
        )
        .run(finalizedAtMs, id);
      return {
        changed: Number(result.changes) > 0,
        row: readGift(giftDb, id),
      };
    },
    listUndelivered(command) {
      return giftDb
        .prepare(
          `SELECT * FROM gift_events WHERE detection_status = 'final'
        AND cmd = ? AND gift_stats_eligible = 1 AND gift_stats_delivered = 0 ORDER BY id ASC`,
        )
        .all(command)
        .map((row) => ({ ...row }));
    },
    countPending(command) {
      return (
        Number(
          giftDb
            .prepare(
              `SELECT COUNT(*) AS count FROM gift_events
        WHERE detection_status = 'progress' AND cmd = ?`,
            )
            .get(command)?.count,
        ) || 0
      );
    },
  };
}

function updateProcessedGift(giftDb, id, sourceId, gift, detectedAtMs) {
  giftDb
    .prepare(
      `
    UPDATE gift_events
    SET gift_id = ?, gift_name = ?, user_name = ?, num = ?,
        unit_price = ?, total_price = ?, coin_type = ?, is_blind_box = ?,
        blind_box_id = ?, blind_box_name = ?, blind_box_price = ?, blind_profit = ?,
        last_platform_at_ms = ?, raw_json = '', updated_at = ?,
        gift_variant_id = ?, blind_box_variant_id = ?,
        avatar_url = COALESCE(avatar_url, ?), guard_level = COALESCE(guard_level, ?)
    WHERE id = ? AND source_id = ? AND detection_status = 'progress'
  `,
    )
    .run(
      gift.giftId,
      gift.giftName,
      gift.userName,
      gift.num,
      gift.unitPrice,
      gift.totalPrice,
      gift.coinType,
      gift.isBlindBox ? 1 : 0,
      gift.blindBoxId,
      gift.blindBoxName,
      gift.blindBoxPrice,
      gift.blindProfit,
      detectedAtMs,
      gift.createdAt,
      gift.giftVariantId ?? null,
      gift.blindBoxVariantId ?? null,
      gift.display?.avatarUrl ?? null,
      gift.display?.guardLevel ?? null,
      Number(id),
      Number(sourceId),
    );
}

function insertProgressGift(giftDb, gift, eligibility) {
  const result = giftDb
    .prepare(
      `
    INSERT INTO gift_events (
      source_id, platform_id, cmd, gift_id, gift_name,
      uid, user_name, num, unit_price, total_price, coin_type,
      is_blind_box, blind_box_id, blind_box_name, blind_box_price, blind_profit,
      gift_variant_id, blind_box_variant_id, avatar_url, guard_level,
      counted_in_sprint, detection_status,
      first_detected_at_ms, last_platform_at_ms, finalized_at_ms,
      gift_stats_eligible, gift_stats_delivered, overtime_epoch,
      status, raw_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      0, 'progress', ?, ?, 0, ?, 0, ?, 'active', ?, ?, ?
    )
  `,
    )
    .run(
      eligibility.sourceId,
      gift.platformId,
      gift.cmd,
      gift.giftId,
      gift.giftName,
      gift.uid,
      gift.userName,
      gift.num,
      gift.unitPrice,
      gift.totalPrice,
      gift.coinType,
      gift.isBlindBox ? 1 : 0,
      gift.blindBoxId,
      gift.blindBoxName,
      gift.blindBoxPrice,
      gift.blindProfit,
      gift.giftVariantId ?? null,
      gift.blindBoxVariantId ?? null,
      gift.display?.avatarUrl ?? null,
      gift.display?.guardLevel ?? null,
      eligibility.detectedAtMs,
      eligibility.detectedAtMs,
      eligibility.giftStatisticsEligible ? 1 : 0,
      eligibility.overtimeEpoch,
      gift.rawJson,
      gift.createdAt,
      gift.createdAt,
    );
  return readGift(giftDb, result.lastInsertRowid);
}

function readGift(giftDb, id) {
  const row = giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(id));
  return row ? { ...row } : null;
}

module.exports = { createGiftProjectionStore };
