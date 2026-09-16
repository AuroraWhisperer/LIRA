'use strict';

const { randomUUID } = require('node:crypto');

function conflict() {
  return Object.assign(new Error('LOTTERY_DRAW_CONFLICT'), {
    code: 'LOTTERY_DRAW_CONFLICT',
  });
}

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      error.cause = rollbackError;
    }
    throw error;
  }
}

function createLotteryDrawStore(db) {
  function getRound(taskId) {
    const row = db
      .prepare(
        `SELECT r.*, o.order_json, o.next_index
      FROM lottery_rounds r JOIN lottery_orders o ON o.id = r.current_order_id
      WHERE r.task_id = ? ORDER BY r.created_at_ms DESC LIMIT 1`,
      )
      .get(taskId);
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.task_id,
      scanId: row.scan_id,
      rules: JSON.parse(row.rules_json),
      digest: row.member_digest,
      algorithm: row.algorithm_version,
      status: row.status,
      revision: Number(row.revision),
      orderId: row.current_order_id,
      order: JSON.parse(row.order_json),
      nextIndex: Number(row.next_index),
    };
  }

  function event(task, roundId, type, payload, nowMs) {
    db.prepare(
      `INSERT INTO lottery_events
      (streamer_id, task_id, round_id, event_type, payload_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      task.streamerId,
      task.id,
      roundId,
      type,
      JSON.stringify(payload),
      nowMs,
    );
  }

  function freeze({ task, members, order, digest, nowMs }) {
    return transaction(db, () => {
      const existing = getRound(task.id);
      if (existing) return existing;
      const current = db
        .prepare(
          `SELECT t.revision, s.status FROM lottery_tasks t
        JOIN lottery_scans s ON s.id = t.active_scan_id WHERE t.id = ? AND t.streamer_id = ?`,
        )
        .get(task.id, task.streamerId);
      if (
        !current ||
        current.revision !== task.revision ||
        current.status !== 'completed'
      )
        throw conflict();
      const roundId = randomUUID();
      const orderId = randomUUID();
      db.prepare(
        `INSERT INTO lottery_rounds (id, task_id, scan_id, rules_json,
        member_digest, algorithm_version, status, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, 'fisher-yates-crypto-v1', 'frozen', ?, ?)`,
      ).run(
        roundId,
        task.id,
        task.activeScanId,
        JSON.stringify(task.rules),
        digest,
        nowMs,
        nowMs,
      );
      const insert = db.prepare(`INSERT INTO lottery_round_members
        (round_id, uid, evidence_source, evidence_record_id) VALUES (?, ?, ?, ?)`);
      for (const member of members)
        insert.run(roundId, member.uid, member.source, member.recordId);
      db.prepare(
        `INSERT INTO lottery_orders (id, round_id, scope, generation, kind,
        request_id, order_json, status, created_at_ms, updated_at_ms)
        VALUES (?, ?, 'main', 0, 'initial', ?, ?, 'frozen', ?, ?)`,
      ).run(
        orderId,
        roundId,
        `initial:${task.id}`,
        JSON.stringify(order),
        nowMs,
        nowMs,
      );
      db.prepare(
        'UPDATE lottery_rounds SET current_order_id = ? WHERE id = ?',
      ).run(orderId, roundId);
      db.prepare(
        "UPDATE lottery_tasks SET status = 'frozen', revision = revision + 1, updated_at_ms = ? WHERE id = ?",
      ).run(nowMs, task.id);
      event(
        task,
        roundId,
        'frozen',
        { count: order.length, digest, algorithm: 'fisher-yates-crypto-v1' },
        nowMs,
      );
      return getRound(task.id);
    });
  }

  function winners(roundId) {
    return db
      .prepare(
        `SELECT a.uid, a.slot_index, a.verification_json, a.drawn_at_ms,
          e.display_name, e.text AS comment_text
        FROM lottery_awards a
        JOIN lottery_rounds r ON r.id = a.round_id
        LEFT JOIN lottery_round_members m ON m.round_id = r.id AND m.uid = a.uid
        LEFT JOIN lottery_evidence e ON e.scan_id = r.scan_id
          AND e.source = m.evidence_source AND e.source = 'comment'
          AND e.record_id = m.evidence_record_id AND e.uid = a.uid
        WHERE a.round_id = ? AND a.active = 1 ORDER BY a.slot_index`,
      )
      .all(roundId)
      .map((row) => ({
        uid: row.uid,
        displayName: row.display_name,
        commentText: row.comment_text,
        position: Number(row.slot_index) + 1,
        verification: JSON.parse(row.verification_json),
        drawnAtMs: Number(row.drawn_at_ms),
      }));
  }

  function setStatus(task, status, reason, nowMs) {
    return transaction(db, () => {
      const round = getRound(task.id);
      if (!round || ['completed', 'exhausted'].includes(round.status))
        return round;
      db.prepare(
        'UPDATE lottery_rounds SET status = ?, revision = revision + 1, updated_at_ms = ? WHERE id = ?',
      ).run(status, nowMs, round.id);
      db.prepare(
        'UPDATE lottery_orders SET status = ?, updated_at_ms = ? WHERE id = ?',
      ).run(status, nowMs, round.orderId);
      db.prepare(
        'UPDATE lottery_tasks SET status = ?, revision = revision + 1, updated_at_ms = ? WHERE id = ?',
      ).run(status, nowMs, task.id);
      if (status === 'paused')
        event(
          task,
          round.id,
          'paused',
          { reason, nextIndex: round.nextIndex },
          nowMs,
        );
      return getRound(task.id);
    });
  }

  function recordCheck({ task, roundId, index, uid, verification, nowMs }) {
    return transaction(db, () => {
      const round = getRound(task.id);
      if (
        !round ||
        round.id !== roundId ||
        round.status !== 'drawing' ||
        round.nextIndex !== index ||
        round.order[index] !== uid ||
        !['eligible', 'ineligible'].includes(verification.state)
      )
        throw conflict();
      const accepted = db
        .prepare('SELECT COUNT(*) AS count FROM lottery_awards WHERE round_id = ? AND active = 1')
        .get(round.id).count;
      if (accepted >= round.rules.winnerCount) throw conflict();
      db.prepare(
        `UPDATE lottery_round_members SET qualification_state = ?,
        qualification_reason = ?, checked_at_ms = ? WHERE round_id = ? AND uid = ?`,
      ).run(verification.state, verification.reason, nowMs, round.id, uid);
      if (verification.state === 'eligible') {
        db.prepare(
          `INSERT INTO lottery_awards (id, round_id, order_id, prize_id,
          prize_label, slot_index, uid, status, verification_json, drawn_at_ms,
          created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'main', '中奖名额', ?, ?, 'selected', ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          round.id,
          round.orderId,
          accepted,
          uid,
          JSON.stringify(verification),
          nowMs,
          nowMs,
          nowMs,
        );
      }
      const filled = accepted + (verification.state === 'eligible' ? 1 : 0);
      const status =
        filled >= round.rules.winnerCount
          ? 'completed'
          : index + 1 >= round.order.length
            ? 'exhausted'
            : 'drawing';
      db.prepare(
        'UPDATE lottery_orders SET next_index = ?, status = ?, updated_at_ms = ? WHERE id = ?',
      ).run(index + 1, status, nowMs, round.orderId);
      db.prepare(
        `UPDATE lottery_rounds SET status = ?, revision = revision + 1,
        result_version = result_version + 1, updated_at_ms = ? WHERE id = ?`,
      ).run(status, nowMs, round.id);
      db.prepare(
        'UPDATE lottery_tasks SET status = ?, revision = revision + 1, updated_at_ms = ? WHERE id = ?',
      ).run(status, nowMs, task.id);
      event(
        task,
        round.id,
        'candidate_checked',
        { uid, index, state: verification.state, reason: verification.reason },
        nowMs,
      );
      return getRound(task.id);
    });
  }

  function getResult(taskId) {
    const round = getRound(taskId);
    if (!round) return null;
    const awards = winners(round.id);
    const lastPause = db
      .prepare(
        "SELECT payload_json FROM lottery_events WHERE round_id = ? AND event_type = 'paused' ORDER BY id DESC LIMIT 1",
      )
      .get(round.id);
    return {
      roundId: round.id,
      status: round.status,
      revision: round.revision,
      candidateCount: round.order.length,
      checkedCount: round.nextIndex,
      excludedCount: round.nextIndex - awards.length,
      requestedCount: round.rules.winnerCount,
      shortage:
        round.status === 'exhausted'
          ? round.rules.winnerCount - awards.length
          : 0,
      reason:
        round.status === 'paused'
          ? lastPause
            ? JSON.parse(lastPause.payload_json).reason
            : 'LOTTERY_INTERRUPTED'
          : '',
      digest: round.digest,
      algorithm: round.algorithm,
      winners: awards,
    };
  }

  function recoverInterrupted(nowMs) {
    transaction(db, () => {
      db.prepare(
        "UPDATE lottery_rounds SET status = 'paused', revision = revision + 1, updated_at_ms = ? WHERE status = 'drawing'",
      ).run(nowMs);
      db.prepare(
        "UPDATE lottery_orders SET status = 'paused', updated_at_ms = ? WHERE status = 'drawing'",
      ).run(nowMs);
      db.prepare(
        "UPDATE lottery_tasks SET status = 'paused', revision = revision + 1, updated_at_ms = ? WHERE status = 'drawing'",
      ).run(nowMs);
    });
  }

  return {
    getRound,
    freeze,
    getResult,
    setStatus,
    recordCheck,
    recoverInterrupted,
  };
}

module.exports = { createLotteryDrawStore };
