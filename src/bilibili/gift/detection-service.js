'use strict';

const { normalizeGiftInput, normalizeGiftRow } = require('./normalizer');
const {
  extractComboRootKey,
  applyBlindBoxMetadata,
  findGiftByPlatformIdentity,
  findRecentGiftCommandDuplicate,
  updateGiftEventIfProgressed,
  logGiftServiceDecision
} = require('./event-service');
const { normalizeMoney } = require('../../shared/utils');

const GIFT_FINALIZE_QUIET_MS = 10 * 1000;
const CONSUMER_RETRY_MAX_MS = 30 * 1000;

function createGiftDetectionService(context, options = {}) {
  const giftDb = context?.db?.giftDb;
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create GiftDetectionService.');
  }

  const consumerRegistry = options.consumerRegistry || { dispatch: () => ({ delivered: [], failed: [] }) };
  const getOvertimeEpoch = typeof options.getOvertimeEpoch === 'function'
    ? options.getOvertimeEpoch
    : () => 0;
  const nowMs = typeof options.now === 'function' ? options.now : Date.now;
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const captureWhenDisabled = options.captureWhenDisabled === true;
  const onGiftFinalized = typeof options.onGiftFinalized === 'function'
    ? options.onGiftFinalized
    : (typeof options.onGiftFlushed === 'function' ? options.onGiftFlushed : null);
  const timers = new Map();
  const consumerRetryTimers = new Map();
  const consumerRetryAttempts = new Map();
  let disposed = false;

  function detect(input) {
    if (disposed) return null;

    const giftStatisticsEligible = context.settings().enableGiftSprint === 'true';
    const overtimeEpoch = Math.max(0, Math.floor(Number(getOvertimeEpoch()) || 0));
    if (!giftStatisticsEligible && overtimeEpoch === 0 && !captureWhenDisabled) {
      logGiftServiceDecision('ignored', input, null, 'all-consumers-disabled');
      return null;
    }

    const detectedAtMs = Math.floor(nowMs());
    const gift = normalizeGiftInput(input);
    if (!gift.giftName && !gift.giftId) {
      logGiftServiceDecision('ignored', gift, null, 'invalid-gift');
      return null;
    }
    if (gift.totalPrice <= 0) {
      logGiftServiceDecision('ignored', gift, null, 'non-positive-price');
      return null;
    }

    const comboKey = extractComboRootKey(gift.comboId || gift.platformId);
    if (comboKey) gift.platformId = comboKey;
    applyComboTotals(gift);
    applyBlindBoxMetadata(context, gift);

    let row = gift.platformId ? findGiftByPlatformIdentity(giftDb, gift) : null;
    if (!row) row = findRecentGiftCommandDuplicate(context, gift);
    if (row?.status === 'deleted') return null;
    if (row?.detection_status === 'final') {
      logGiftServiceDecision('deduplicated', gift, row, 'final-event');
      return normalizeGiftRow(row);
    }

    if (row) {
      updateGiftEventIfProgressed(context, row, gift, { updateSprint: false });
      giftDb.prepare(`
        UPDATE gift_events
        SET last_platform_at_ms = ?
        WHERE id = ? AND detection_status = 'progress'
      `).run(detectedAtMs, Number(row.id));
      row = readGift(giftDb, row.id);
      logGiftServiceDecision('updated', gift, row, 'detection-progress');
    } else {
      row = insertProgressGift(giftDb, gift, {
        detectedAtMs,
        giftStatisticsEligible,
        overtimeEpoch
      });
      logGiftServiceDecision('inserted', gift, row, 'detection-progress');
    }

    dispatch(row, 'progress');
    if (isPlatformFinal(gift, comboKey)) {
      return finalizeDetected(row.id, detectedAtMs);
    }
    scheduleFinalization(row);
    return row;
  }

  function finalizeDetected(giftEventId, finalizedAtMs = Math.floor(nowMs())) {
    const id = Number(giftEventId) || 0;
    if (id <= 0) return null;
    clearGiftTimer(id);

    const result = giftDb.prepare(`
      UPDATE gift_events
      SET detection_status = 'final', finalized_at_ms = ?
      WHERE id = ? AND detection_status = 'progress'
    `).run(finalizedAtMs, id);
    const row = readGift(giftDb, id);
    if (!row || Number(result.changes) === 0) return row;

    dispatch(row, 'final');
    if (onGiftFinalized) onGiftFinalized(row);
    return row;
  }

  function scheduleFinalization(row) {
    const id = Number(row?.id) || 0;
    if (id <= 0 || row.detection_status !== 'progress') return;
    clearGiftTimer(id);
    const dueAtMs = Number(row.last_platform_at_ms) + GIFT_FINALIZE_QUIET_MS;
    const timer = scheduleTimeout(() => {
      timers.delete(id);
      finalizeDetected(id, Math.floor(nowMs()));
    }, Math.max(0, dueAtMs - nowMs()));
    if (timer && typeof timer.unref === 'function') timer.unref();
    timers.set(id, timer);
  }

  function flushPending({ force = false } = {}) {
    const rows = giftDb.prepare(`
      SELECT * FROM gift_events
      WHERE detection_status = 'progress'
      ORDER BY id ASC
    `).all();
    const currentMs = Math.floor(nowMs());
    for (const row of rows) {
      if (force || Number(row.last_platform_at_ms) + GIFT_FINALIZE_QUIET_MS <= currentMs) {
        finalizeDetected(row.id, currentMs);
      } else {
        scheduleFinalization(row);
      }
    }
  }

  function recover() {
    flushPending();
    const finalRows = giftDb.prepare(`
      SELECT * FROM gift_events
      WHERE detection_status = 'final'
        AND gift_stats_eligible = 1
        AND gift_stats_delivered = 0
      ORDER BY id ASC
    `).all();
    for (const row of finalRows) dispatch(row, 'final');
  }

  function getStatus() {
    const giftStatistics = context.settings().enableGiftSprint === 'true';
    const overtime = Math.max(0, Math.floor(Number(getOvertimeEpoch()) || 0)) > 0;
    const pendingCount = Number(giftDb.prepare(`
      SELECT COUNT(*) AS count FROM gift_events WHERE detection_status = 'progress'
    `).get()?.count) || 0;
    return {
      coreActive: giftStatistics || overtime || captureWhenDisabled || pendingCount > 0,
      consumers: { giftStatistics, overtime, giftEffects: captureWhenDisabled },
      pendingCount
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const timer of timers.values()) cancelTimeout(timer);
    timers.clear();
    for (const timer of consumerRetryTimers.values()) cancelTimeout(timer);
    consumerRetryTimers.clear();
    consumerRetryAttempts.clear();
    flushPending({ force: true });
  }

  function clearGiftTimer(id) {
    const timer = timers.get(id);
    if (!timer) return;
    cancelTimeout(timer);
    timers.delete(id);
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
    if (disposed || id <= 0 || consumerRetryTimers.has(id)) return;
    const attempt = consumerRetryAttempts.get(id) || 0;
    const delayMs = Math.min(CONSUMER_RETRY_MAX_MS, 1000 * (2 ** attempt));
    consumerRetryAttempts.set(id, Math.min(attempt + 1, 5));
    const timer = scheduleTimeout(() => {
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
  return { detect, recover, flushPending, finalizeDetected, getStatus, dispose };
}

function insertProgressGift(giftDb, gift, eligibility) {
  const result = giftDb.prepare(`
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name,
      uid, user_name, num, unit_price, total_price, coin_type,
      is_blind_box, blind_box_name, blind_box_price, blind_profit,
      counted_in_sprint, detection_status,
      first_detected_at_ms, last_platform_at_ms, finalized_at_ms,
      gift_stats_eligible, gift_stats_delivered, overtime_epoch,
      status, raw_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      0, 'progress', ?, ?, 0, ?, 0, ?, 'active', ?, ?, ?
    )
  `).run(
    gift.platformId, gift.cmd, gift.giftId, gift.giftName,
    gift.uid, gift.userName, gift.num, gift.unitPrice, gift.totalPrice, gift.coinType,
    gift.isBlindBox ? 1 : 0, gift.blindBoxName, gift.blindBoxPrice, gift.blindProfit,
    eligibility.detectedAtMs, eligibility.detectedAtMs,
    eligibility.giftStatisticsEligible ? 1 : 0, eligibility.overtimeEpoch,
    gift.rawJson, gift.createdAt, gift.createdAt
  );
  return readGift(giftDb, result.lastInsertRowid);
}

function applyComboTotals(gift) {
  if (gift.comboNum > gift.num) gift.num = gift.comboNum;
  if (gift.comboTotalPrice > gift.totalPrice) gift.totalPrice = gift.comboTotalPrice;
  if (gift.num > 0) gift.unitPrice = normalizeMoney(gift.totalPrice / gift.num);
}

function isPlatformFinal(gift, comboKey) {
  return gift.cmd.startsWith('COMBO_SEND') || !comboKey;
}

function toStandardEvent(row, phase = row?.detection_status) {
  const gift = normalizeGiftRow(row);
  return Object.freeze({
    phase,
    giftEventId: Number(row?.id) || 0,
    gift,
    eligibility: Object.freeze({
      giftStatistics: Number(row?.gift_stats_eligible) === 1,
      overtimeEpoch: Math.max(0, Number(row?.overtime_epoch) || 0)
    })
  });
}

function readGift(giftDb, id) {
  return normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(id)));
}

module.exports = {
  GIFT_FINALIZE_QUIET_MS,
  createGiftDetectionService,
  toStandardEvent
};
