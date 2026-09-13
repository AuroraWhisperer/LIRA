'use strict';

// Persist server-confirmed gifts and deliver them to local consumers.

const { normalizeGiftRow } = require('./normalizer');
const {
  canonicalizeProcessedGiftEvent,
  canonicalizeProcessedGiftHistoryRecord,
} = require('../../shared/processed-gift-contract');
const CONSUMER_RETRY_MAX_MS = 30 * 1000;
const REMOTE_GIFT_COMMAND = 'LIRA_SERVER_GIFT';

function createGiftProjectionService(context, options = {}) {
  const giftDb = context?.db?.giftDb;
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create GiftProjectionService.');
  }

  const consumerRegistry = options.consumerRegistry || {
    dispatch: () => ({ delivered: [], failed: [] }),
  };
  const getOvertimeEpoch =
    typeof options.getOvertimeEpoch === 'function'
      ? options.getOvertimeEpoch
      : () => 0;
  const nowMs = typeof options.now === 'function' ? options.now : Date.now;
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const captureWhenDisabled = options.captureWhenDisabled === true;
  const onGiftFinalized =
    typeof options.onGiftFinalized === 'function'
      ? options.onGiftFinalized
      : typeof options.onGiftFlushed === 'function'
        ? options.onGiftFlushed
        : null;
  const consumerRetryTimers = new Map();
  const consumerRetryAttempts = new Map();
  let detectionPaused = false;
  let detectionGeneration = 0;
  let disposed = false;

  function importProcessedEvent(input, sourceId, importOptions = {}) {
    if (detectionPaused) throw new Error('GIFT_DETECTION_PAUSED');
    if (disposed) return null;

    const capturedSourceId = requireRemoteSource(giftDb, sourceId);
    const event = canonicalizeProcessedGiftEvent(input);
    const platformId = `lira-server:${event.eventId}`;
    let row = giftDb
      .prepare(
        `
      SELECT * FROM gift_events
      WHERE source_id = ? AND platform_id = ? AND cmd = ?
      ORDER BY id ASC LIMIT 1
    `,
      )
      .get(capturedSourceId, platformId, REMOTE_GIFT_COMMAND);
    if (
      row &&
      [
        [row.gift_variant_id, event.gift.giftVariantId],
        [row.blind_box_variant_id, event.gift.blindBoxVariantId],
      ].some(([stored, incoming]) => stored && incoming && stored !== incoming)
    ) {
      throw new Error('PROCESSED_GIFT_EVENT_CONFLICT');
    }
    if (
      (row?.status === 'deleted' || row?.detection_status === 'final') &&
      event.phase === 'final' &&
      !isMatchingHistoryProjection(row, {
        eventId: event.eventId,
        gift: event.gift,
      })
    ) {
      throw new Error('PROCESSED_GIFT_EVENT_CONFLICT');
    }
    if (row?.status === 'deleted' || row?.detection_status === 'final') {
      return normalizeGiftRow(row);
    }

    const detectedAtMs = Math.floor(nowMs());
    const gift = {
      ...event.gift,
      platformId,
      cmd: REMOTE_GIFT_COMMAND,
      uid: '',
      rawJson: '',
    };
    if (!row) {
      const giftStatisticsEligible =
        context.settings().enableGiftSprint === 'true';
      const overtimeEpoch = Math.max(
        0,
        Math.floor(Number(getOvertimeEpoch()) || 0),
      );
      // Server-processed events are already authoritative. Always persist the
      // projection so the remote cursor can advance without losing a final
      // event merely because local consumers are currently disabled.
      row = insertProgressGift(giftDb, gift, {
        sourceId: capturedSourceId,
        detectedAtMs,
        giftStatisticsEligible,
        overtimeEpoch,
      });
      if (event.phase === 'progress') dispatch(row, 'progress');
    } else {
      updateProcessedGift(giftDb, row.id, capturedSourceId, gift, detectedAtMs);
      row = readGift(giftDb, row.id);
    }

    if (event.phase === 'progress') return row;
    updateProcessedGift(giftDb, row.id, capturedSourceId, gift, detectedAtMs);
    return finalizeImportedGift(row.id, detectedAtMs, importOptions);
  }

  function importProcessedHistoryRecord(input, sourceId) {
    if (detectionPaused) throw new Error('GIFT_DETECTION_PAUSED');
    if (disposed) return null;

    const capturedSourceId = requireRemoteSource(giftDb, sourceId);
    const record = canonicalizeProcessedGiftHistoryRecord(input);
    const platformId = `lira-server:${record.eventId}`;
    const existing = giftDb
      .prepare(
        `
        SELECT * FROM gift_events
        WHERE source_id = ? AND platform_id = ? AND cmd = ?
        ORDER BY id ASC LIMIT 1
      `,
      )
      .get(capturedSourceId, platformId, REMOTE_GIFT_COMMAND);
    if (existing) {
      if (!isMatchingHistoryProjection(existing, record)) {
        throw new Error('PROCESSED_GIFT_HISTORY_CONFLICT');
      }
      return normalizeGiftRow(existing);
    }

    const gift = record.gift;
    const createdAtMs = Date.parse(gift.createdAt);
    const result = giftDb
      .prepare(
        `
        INSERT INTO gift_events (
          source_id, platform_id, cmd, gift_id, gift_name,
          uid, user_name, num, unit_price, total_price, coin_type,
          is_blind_box, blind_box_id, blind_box_name, blind_box_price, blind_profit,
          gift_variant_id, blind_box_variant_id,
          counted_in_sprint, detection_status,
          first_detected_at_ms, last_platform_at_ms, finalized_at_ms,
          gift_stats_eligible, gift_stats_delivered, overtime_epoch,
          status, raw_json, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?,
          0, 'final', ?, ?, ?, 0, 1, 0, 'active', '', ?, ?
        )
      `,
      )
      .run(
        capturedSourceId,
        platformId,
        REMOTE_GIFT_COMMAND,
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
        createdAtMs,
        createdAtMs,
        createdAtMs,
        gift.createdAt,
        gift.createdAt,
      );
    return readGift(giftDb, result.lastInsertRowid);
  }

  function finalizeImportedGift(
    giftEventId,
    finalizedAtMs = Math.floor(nowMs()),
    finalizeOptions = {},
  ) {
    if (detectionPaused) return null;
    const id = Number(giftEventId) || 0;
    if (id <= 0) return null;

    const result = giftDb
      .prepare(
        `
      UPDATE gift_events
      SET detection_status = 'final', finalized_at_ms = ?
      WHERE id = ? AND detection_status = 'progress'
    `,
      )
      .run(finalizedAtMs, id);
    const row = readGift(giftDb, id);
    if (!row || Number(result.changes) === 0) return row;

    const generation = detectionGeneration;
    const deliverFinal = () => {
      if (detectionPaused || generation !== detectionGeneration) return;
      dispatch(row, 'final');
      if (onGiftFinalized) onGiftFinalized(row);
    };
    if (typeof finalizeOptions.registerAfterCommit === 'function') {
      finalizeOptions.registerAfterCommit(deliverFinal);
    } else {
      deliverFinal();
    }
    return row;
  }

  function recover() {
    if (disposed || detectionPaused) return;
    const finalRows = giftDb
      .prepare(
        `
      SELECT * FROM gift_events
      WHERE detection_status = 'final'
        AND cmd = ?
        AND gift_stats_eligible = 1
        AND gift_stats_delivered = 0
      ORDER BY id ASC
    `,
      )
      .all(REMOTE_GIFT_COMMAND);
    for (const row of finalRows) dispatch(row, 'final');
  }

  function getStatus() {
    const giftStatistics = context.settings().enableGiftSprint === 'true';
    const overtime =
      Math.max(0, Math.floor(Number(getOvertimeEpoch()) || 0)) > 0;
    const pendingCount =
      Number(
        giftDb
          .prepare(
            `
      SELECT COUNT(*) AS count FROM gift_events WHERE detection_status = 'progress'
        AND cmd = ?
    `,
          )
          .get(REMOTE_GIFT_COMMAND)?.count,
      ) || 0;
    return {
      coreActive:
        giftStatistics || overtime || captureWhenDisabled || pendingCount > 0,
      consumers: { giftStatistics, overtime, giftEffects: captureWhenDisabled },
      pendingCount,
    };
  }

  function cancelPendingTimers() {
    for (const timer of consumerRetryTimers.values()) cancelTimeout(timer);
    consumerRetryTimers.clear();
  }

  function pauseDetection() {
    if (disposed || detectionPaused) return false;
    detectionPaused = true;
    detectionGeneration += 1;
    cancelPendingTimers();
    return true;
  }

  function resumeDetection() {
    if (disposed || !detectionPaused) return;
    detectionPaused = false;
    try {
      recover();
      // 非统计消费者的失败也可能留有重试；只恢复仍存在的已落库事件。
      for (const id of consumerRetryAttempts.keys()) {
        const row = readGift(giftDb, id);
        if (row?.detection_status === 'final') scheduleConsumerRetry(id);
        else clearConsumerRetry(id);
      }
    } catch (error) {
      pauseDetection();
      throw error;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelPendingTimers();
    consumerRetryAttempts.clear();
  }

  function dispatch(row, phase) {
    const result = consumerRegistry.dispatch(toStandardEvent(row, phase));
    if (phase !== 'final') return result;

    const id = Number(row?.id) || 0;
    if (result.failed.length > 0) {
      scheduleConsumerRetry(id);
    } else {
      clearConsumerRetry(id);
    }
    return result;
  }

  function scheduleConsumerRetry(id) {
    if (disposed || detectionPaused || id <= 0 || consumerRetryTimers.has(id))
      return;
    const attempt = consumerRetryAttempts.get(id) || 0;
    const delayMs = Math.min(CONSUMER_RETRY_MAX_MS, 1000 * 2 ** attempt);
    consumerRetryAttempts.set(id, Math.min(attempt + 1, 5));
    const generation = detectionGeneration;
    const timer = scheduleTimeout(() => {
      if (detectionPaused || generation !== detectionGeneration) return;
      consumerRetryTimers.delete(id);
      const row = readGift(giftDb, id);
      if (!row || row.detection_status !== 'final') {
        clearConsumerRetry(id);
        return;
      }
      dispatch(row, 'final');
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    consumerRetryTimers.set(id, timer);
  }

  function clearConsumerRetry(id) {
    const timer = consumerRetryTimers.get(id);
    if (timer) cancelTimeout(timer);
    consumerRetryTimers.delete(id);
    consumerRetryAttempts.delete(id);
  }

  recover();
  return {
    importProcessedEvent,
    importProcessedHistoryRecord,
    recover,
    pauseDetection,
    resumeDetection,
    getStatus,
    dispose,
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
        last_platform_at_ms = ?, raw_json = '', updated_at = ?
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
      gift_variant_id, blind_box_variant_id,
      counted_in_sprint, detection_status,
      first_detected_at_ms, last_platform_at_ms, finalized_at_ms,
      gift_stats_eligible, gift_stats_delivered, overtime_epoch,
      status, raw_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?,
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

function requireRemoteSource(giftDb, sourceId) {
  const id = Number(sourceId);
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !giftDb.prepare('SELECT 1 FROM gift_sources WHERE id = ?').get(id)
  ) {
    throw new Error('REMOTE_GIFT_SOURCE_REQUIRED');
  }
  return id;
}

function isMatchingHistoryProjection(row, record) {
  if (row.detection_status !== 'final' || row.status !== 'active') return false;
  try {
    const existing = canonicalizeProcessedGiftHistoryRecord({
      eventId: record.eventId,
      gift: {
        giftId: row.gift_id,
        giftName: row.gift_name,
        userName: row.user_name,
        num: row.num,
        unitPrice: row.unit_price,
        totalPrice: row.total_price,
        coinType: row.coin_type,
        isBlindBox: Number(row.is_blind_box) === 1,
        blindBoxId: row.blind_box_id,
        blindBoxName: row.blind_box_name,
        blindBoxPrice: row.blind_box_price,
        blindProfit: row.blind_profit,
        createdAt: row.created_at,
        giftVariantId: row.gift_variant_id,
        blindBoxVariantId: row.blind_box_variant_id,
      },
    });
    for (const [column, key] of [
      ['gift_variant_id', 'giftVariantId'],
      ['blind_box_variant_id', 'blindBoxVariantId'],
    ]) {
      if (row[column] && record.gift[key] && row[column] !== record.gift[key])
        return false;
    }
    // Older installed clients persisted no identity. Confirm the historical
    // display projection without rewriting its identity or replaying consumers.
    return (
      JSON.stringify(existing) ===
      JSON.stringify({
        ...record,
        gift: {
          ...record.gift,
          giftVariantId: existing.gift.giftVariantId,
          blindBoxVariantId: existing.gift.blindBoxVariantId,
        },
      })
    );
  } catch {
    return false;
  }
}

function toStandardEvent(row, phase = row?.detection_status) {
  const gift = normalizeGiftRow(row);
  return Object.freeze({
    phase,
    giftEventId: Number(row?.id) || 0,
    gift,
    eligibility: Object.freeze({
      giftStatistics: Number(row?.gift_stats_eligible) === 1,
      overtimeEpoch: Math.max(0, Number(row?.overtime_epoch) || 0),
    }),
  });
}

function readGift(giftDb, id) {
  return normalizeGiftRow(
    giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(id)),
  );
}

module.exports = {
  REMOTE_GIFT_COMMAND,
  createGiftProjectionService,
  toStandardEvent,
};
