'use strict';

const { canonicalizeGuardGiftId } = require('../bilibili/gift/guard-gift-aliases');

function createOvertimeStore(giftDb) {
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create OvertimeStore.');
  }

  function getState() {
    return giftDb.prepare('SELECT * FROM overtime_machine_state WHERE id = 1').get() || null;
  }

  function ensureState(updatedAt) {
    giftDb.prepare(`
      INSERT OR IGNORE INTO overtime_machine_state (
        id, enabled, enable_epoch, initial_seconds, remaining_ms,
        anchor_at_ms, status, background_path, background_fit, revision, updated_at
      ) VALUES (1, 0, 0, 0, 0, 0, 'paused', '', 'cover', 0, ?)
    `).run(updatedAt);
    return getState();
  }

  function saveState(state) {
    giftDb.prepare(`
      UPDATE overtime_machine_state
      SET enabled = ?, enable_epoch = ?, initial_seconds = ?, remaining_ms = ?,
          anchor_at_ms = ?, status = ?, background_path = ?, background_fit = ?,
          revision = ?, updated_at = ?
      WHERE id = 1
    `).run(
      state.enabled ? 1 : 0,
      state.enableEpoch,
      state.initialSeconds,
      state.remainingMs,
      state.anchorAtMs,
      state.status,
      state.backgroundPath,
      state.backgroundFit,
      state.revision,
      state.updatedAt
    );
  }

  function saveStateAndIgnorePending(state) {
    return immediate(() => {
      saveState(state);
      return giftDb.prepare(`
        UPDATE overtime_settlements
        SET status = 'ignored', rule_mode = 'ignored', settle_after_ms = 0,
            last_error = '', updated_at = ?
        WHERE status = 'pending'
      `).run(state.updatedAt).changes;
    });
  }

  function listRules() {
    return giftDb.prepare(`
      SELECT * FROM overtime_gift_rules
      ORDER BY sort_order ASC, gift_id ASC
    `).all().map(normalizeRule);
  }

  function replaceRules(rules, updatedAt) {
    const insert = giftDb.prepare(`
      INSERT INTO overtime_gift_rules (
        gift_id, gift_name, image_path, mode, fixed_seconds,
        outcomes_json, enabled, sort_order, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return immediate(() => {
      giftDb.prepare('DELETE FROM overtime_gift_rules').run();
      for (const rule of rules) {
        insert.run(
          rule.giftId,
          rule.giftName,
          rule.imagePath,
          rule.mode,
          rule.fixedSeconds,
          rule.mode === 'random'
            ? JSON.stringify({ version: 2, quantityMode: rule.quantityMode, outcomes: rule.outcomes })
            : rule.mode === 'display'
              ? JSON.stringify({ version: 3, quantityMode: rule.quantityMode, displayText: rule.displayText })
              : JSON.stringify({ version: 2, quantityMode: rule.quantityMode, effect: rule.fixedEffect }),
          rule.enabled ? 1 : 0,
          rule.sortOrder,
          updatedAt
        );
      }
    });
  }

  function observeGift(giftEventId, updatedAt) {
    return immediate(() => {
      const state = getState();
      const gift = getGift(giftEventId);
      const settlement = getSettlement(giftEventId);
      if (isComplete(settlement)) return { kind: 'complete', settlement };
      if (!gift) return { kind: 'missing' };
      if (!isEligible(state, gift)) {
        if (settlement?.status === 'pending') ignoreSettlement(giftEventId, updatedAt);
        return { kind: 'ineligible' };
      }
      ensurePending(gift, updatedAt);
      return { kind: 'pending', settlement: getSettlement(giftEventId) };
    });
  }

  function settleFinal(giftEventId, currentState, updatedAt, resolve) {
    return immediate(() => {
      const persistedState = getState();
      const gift = getGift(giftEventId);
      let settlement = getSettlement(giftEventId);
      if (isComplete(settlement)) return { kind: 'complete', settlement };
      if (!gift) return { kind: 'missing' };
      if (!isEligible(persistedState, gift) ||
          !currentState.enabled ||
          currentState.enableEpoch !== Number(persistedState.enable_epoch)) {
        if (settlement?.status === 'pending') ignoreSettlement(giftEventId, updatedAt);
        return { kind: 'ineligible' };
      }

      ensurePending(gift, updatedAt);
      settlement = getSettlement(giftEventId);
      if (gift.detection_status !== 'final') return { kind: 'pending', settlement };

      const rawGiftId = String(gift.gift_id || '').trim();
      const canonicalGiftId = canonicalizeGuardGiftId(rawGiftId);
      const findRule = giftDb.prepare(`
        SELECT * FROM overtime_gift_rules WHERE gift_id = ? AND enabled = 1
      `);
      const ruleRow = findRule.get(canonicalGiftId)
        || (canonicalGiftId !== rawGiftId ? findRule.get(rawGiftId) : null);
      if (!ruleRow) {
        ignoreSettlement(giftEventId, updatedAt);
        return { kind: 'ignored', settlement: getSettlement(giftEventId) };
      }

      const resolution = resolve({ gift, rule: normalizeRule(ruleRow) });
      saveState(resolution.state);
      giftDb.prepare(`
        UPDATE overtime_settlements
        SET status = 'applied', gift_id = ?, gift_name = ?, quantity = ?, total_price = ?,
            event_created_at = ?, event_updated_at = ?, settle_after_ms = 0,
            last_error = '', rule_mode = ?, rule_snapshot_json = ?,
            requested_delta_seconds = ?, applied_delta_seconds = ?, outcomes_json = ?,
            updated_at = ?
        WHERE gift_event_id = ? AND status = 'pending'
      `).run(
        String(gift.gift_id || ''),
        String(gift.gift_name || ''),
        normalizeQuantity(gift.num),
        Number(gift.total_price) || 0,
        String(gift.created_at || ''),
        String(gift.updated_at || ''),
        resolution.ruleMode,
        resolution.ruleSnapshotJson,
        resolution.requestedDeltaSeconds,
        resolution.appliedDeltaSeconds,
        resolution.outcomesJson,
        updatedAt,
        Number(giftEventId)
      );
      return {
        kind: 'applied',
        settlement: getSettlement(giftEventId),
        state: resolution.state,
        adjustment: resolution.adjustment
      };
    });
  }

  function recordFailure(giftEventId, error, nowMs, updatedAt) {
    return immediate(() => {
      const settlement = getSettlement(giftEventId);
      if (settlement?.status !== 'pending') return null;
      const retryCount = Math.max(0, Number(settlement.retry_count) || 0) + 1;
      const delaySeconds = Math.min(30, 2 ** Math.max(0, retryCount - 1));
      const settleAfterMs = Math.floor(nowMs) + delaySeconds * 1000;
      giftDb.prepare(`
        UPDATE overtime_settlements
        SET retry_count = ?, settle_after_ms = ?, last_error = ?, updated_at = ?
        WHERE gift_event_id = ? AND status = 'pending'
      `).run(
        retryCount,
        settleAfterMs,
        sanitizeError(error),
        updatedAt,
        Number(giftEventId)
      );
      return { retryCount, settleAfterMs };
    });
  }

  function listRecoverableFinal(enableEpoch, nowMs) {
    return giftDb.prepare(`
      SELECT g.id
      FROM gift_events g
      LEFT JOIN overtime_settlements s ON s.gift_event_id = g.id
      WHERE g.detection_status = 'final'
        AND g.overtime_epoch = ?
        AND (s.id IS NULL OR (s.status = 'pending' AND s.settle_after_ms <= ?))
      ORDER BY g.id ASC
      LIMIT 100
    `).all(Number(enableEpoch), Math.floor(nowMs)).map(row => Number(row.id));
  }

  function getNextPendingAt(enableEpoch) {
    const row = giftDb.prepare(`
      SELECT MIN(s.settle_after_ms) AS next_at
      FROM overtime_settlements s
      JOIN gift_events g ON g.id = s.gift_event_id
      WHERE s.status = 'pending' AND g.overtime_epoch = ?
    `).get(Number(enableEpoch));
    return row?.next_at === null || row?.next_at === undefined ? null : Number(row.next_at);
  }

  function getSettlement(giftEventId) {
    return giftDb.prepare(`
      SELECT * FROM overtime_settlements WHERE gift_event_id = ?
    `).get(Number(giftEventId)) || null;
  }

  function countPending() {
    return Number(giftDb.prepare(`
      SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = 'pending'
    `).get()?.count) || 0;
  }

  function listRecent(limit = 20) {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    return giftDb.prepare(`
      SELECT * FROM overtime_settlements
      WHERE status IN ('applied', 'ignored')
      ORDER BY id DESC
      LIMIT ?
    `).all(safeLimit).map(normalizeSettlement);
  }

  function getGift(giftEventId) {
    return giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(giftEventId)) || null;
  }

  function ensurePending(gift, updatedAt) {
    giftDb.prepare(`
      INSERT INTO overtime_settlements (
        gift_event_id, status, gift_id, gift_name, quantity, total_price,
        event_created_at, event_updated_at, settle_after_ms, retry_count,
        last_error, rule_mode, rule_snapshot_json, outcomes_json, created_at, updated_at
      ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, 0, 0, '', '', '', '', ?, ?)
      ON CONFLICT(gift_event_id) DO UPDATE SET
        gift_id = excluded.gift_id,
        gift_name = excluded.gift_name,
        quantity = excluded.quantity,
        total_price = excluded.total_price,
        event_created_at = excluded.event_created_at,
        event_updated_at = excluded.event_updated_at,
        updated_at = excluded.updated_at
      WHERE overtime_settlements.status = 'pending'
    `).run(
      Number(gift.id),
      String(gift.gift_id || ''),
      String(gift.gift_name || ''),
      normalizeQuantity(gift.num),
      Number(gift.total_price) || 0,
      String(gift.created_at || ''),
      String(gift.updated_at || ''),
      updatedAt,
      updatedAt
    );
  }

  function ignoreSettlement(giftEventId, updatedAt) {
    giftDb.prepare(`
      UPDATE overtime_settlements
      SET status = 'ignored', rule_mode = 'ignored', settle_after_ms = 0,
          last_error = '', updated_at = ?
      WHERE gift_event_id = ? AND status = 'pending'
    `).run(updatedAt, Number(giftEventId));
  }

  function immediate(work) {
    giftDb.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      giftDb.exec('COMMIT');
      return result;
    } catch (error) {
      giftDb.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    getState,
    ensureState,
    saveState,
    saveStateAndIgnorePending,
    listRules,
    replaceRules,
    observeGift,
    settleFinal,
    recordFailure,
    listRecoverableFinal,
    getNextPendingAt,
    getSettlement,
    countPending,
    listRecent
  };
}

function normalizeRule(row) {
  const stored = parseStoredJson(row.outcomes_json);
  const fixedSeconds = row.mode === 'display'
    ? null
    : row.fixed_seconds === null ? null : Number(row.fixed_seconds);
  const displayText = row.mode === 'display' && stored?.version === 3
    ? String(stored.displayText || '')
    : '';
  const fixedEffect = row.mode === 'display'
    ? null
    : stored?.version === 2 && stored.effect
      ? stored.effect
      : effectFromLegacySeconds(fixedSeconds);
  const outcomes = stored?.version === 2 && Array.isArray(stored.outcomes)
    ? stored.outcomes
    : parseLegacyOutcomes(stored);
  const normalized = {
    giftId: row.gift_id,
    giftName: row.gift_name,
    imagePath: row.image_path,
    mode: row.mode,
    quantityMode: [2, 3].includes(stored?.version) && stored?.quantityMode === 'item' ? 'item' : 'group',
    fixedSeconds,
    fixedEffect,
    outcomes,
    enabled: Number(row.enabled) === 1,
    sortOrder: Number(row.sort_order),
    updatedAt: row.updated_at
  };
  if (row.mode === 'display') normalized.displayText = displayText;
  return normalized;
}

function parseLegacyOutcomes(stored) {
  if (stored?.version !== 1 || !Array.isArray(stored.outcomes)) return [];
  return stored.outcomes.map(outcome => ({
    ...effectFromLegacySeconds(Number(outcome?.seconds) || 0),
    weight: Number(outcome?.weight) || 0
  }));
}

function effectFromLegacySeconds(seconds) {
  const value = Number(seconds) || 0;
  return value < 0
    ? { operation: 'subtract', value: Math.abs(value) }
    : { operation: 'add', value };
}

function isEligible(state, gift) {
  const currentEpoch = Math.max(0, Number(state?.enable_epoch) || 0);
  return Number(state?.enabled) === 1 &&
    currentEpoch > 0 &&
    Number(gift?.overtime_epoch) === currentEpoch;
}

function isComplete(settlement) {
  return settlement?.status === 'applied' || settlement?.status === 'ignored';
}

function normalizeQuantity(value) {
  const quantity = Math.floor(Number(value) || 1);
  return quantity > 0 ? quantity : 1;
}

function sanitizeError(error) {
  return String(error?.message || error || 'Settlement failed.').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function normalizeSettlement(row) {
  return {
    id: Number(row.id),
    giftEventId: Number(row.gift_event_id),
    status: row.status,
    giftId: row.gift_id,
    giftName: row.gift_name,
    quantity: Number(row.quantity),
    totalPrice: Number(row.total_price),
    eventCreatedAt: row.event_created_at,
    eventUpdatedAt: row.event_updated_at,
    retryCount: Number(row.retry_count),
    ruleMode: row.rule_mode,
    ruleSnapshot: parseStoredJson(row.rule_snapshot_json),
    requestedDeltaSeconds: row.requested_delta_seconds === null
      ? null
      : Number(row.requested_delta_seconds),
    appliedDeltaSeconds: row.applied_delta_seconds === null
      ? null
      : Number(row.applied_delta_seconds),
    outcome: parseStoredJson(row.outcomes_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseStoredJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

module.exports = { createOvertimeStore };
