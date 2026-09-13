'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOvertimeService } = require('../../src/overtime');
const {
  closeDatabases,
  createDatabases,
} = require('../../src/storage/database');

function createFixture() {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-overtime-'),
  );
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  return {
    db,
    clock,
    createService(options = {}) {
      return createOvertimeService({
        giftDb: db.giftDb,
        now: clock.now,
        monotonicNow: clock.monotonicNow,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        ...options,
      });
    },
    insertProgressGift(options = {}) {
      return insertGift(db.giftDb, clock.now(), {
        ...options,
        phase: 'progress',
      });
    },
    insertFinalGift(options = {}) {
      return insertGift(db.giftDb, clock.now(), { ...options, phase: 'final' });
    },
    finalizeGift(id) {
      db.giftDb
        .prepare(
          `
        UPDATE gift_events SET detection_status = 'final', finalized_at_ms = ? WHERE id = ?
      `,
        )
        .run(clock.now(), id);
    },
    getSettlement(id) {
      return (
        db.giftDb
          .prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?')
          .get(id) || null
      );
    },
    countSettlements(id) {
      return (
        Number(
          db.giftDb
            .prepare(
              'SELECT COUNT(*) AS count FROM overtime_settlements WHERE gift_event_id = ?',
            )
            .get(id)?.count,
        ) || 0
      );
    },
    close() {
      closeDatabases(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
function fixedRule(
  giftId,
  fixedSeconds,
  sortOrder = 0,
  quantityMode = 'group',
) {
  return {
    giftId,
    giftName: giftId,
    imagePath: '',
    mode: 'fixed',
    fixedSeconds,
    quantityMode,
    enabled: true,
    sortOrder,
  };
}

function effectRule(giftId, operation, value, sortOrder = 0) {
  return {
    giftId,
    giftName: giftId,
    imagePath: '',
    mode: 'fixed',
    fixedEffect: { operation, value },
    enabled: true,
    sortOrder,
  };
}

function insertGift(giftDb, nowMs, options) {
  const phase = options.phase || 'final';
  const createdAt = new Date(nowMs).toISOString();
  const giftId = String(options.giftId || 'gift-a');
  const num = Number(options.num) || 1;
  const result = giftDb
    .prepare(
      `
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name, uid, user_name, num,
      unit_price, total_price, coin_type, detection_status,
      first_detected_at_ms, last_platform_at_ms, finalized_at_ms,
      gift_stats_eligible, gift_stats_delivered, overtime_epoch,
      status, raw_json, created_at, updated_at
    ) VALUES (?, 'SEND_GIFT', ?, ?, '1', 'viewer', ?, 0.1, ?, 'gold', ?, ?, ?, ?,
      0, 0, ?, 'active', '', ?, ?)
  `,
    )
    .run(
      `platform-${giftId}-${nowMs}-${Math.random()}`,
      giftId,
      options.giftName || giftId,
      num,
      num * 0.1,
      phase,
      nowMs,
      nowMs,
      phase === 'final' ? nowMs : 0,
      Number(options.overtimeEpoch) || 0,
      createdAt,
      createdAt,
    );
  const id = Number(result.lastInsertRowid);
  if (options.giftVariantId)
    giftDb
      .prepare('UPDATE gift_events SET gift_variant_id = ? WHERE id = ?')
      .run(options.giftVariantId, id);
  return {
    phase,
    giftEventId: id,
    gift: {
      giftId,
      giftName: options.giftName || giftId,
      num,
      totalPrice: num * 0.1,
      createdAt,
      updatedAt: createdAt,
    },
    eligibility: {
      giftStatistics: false,
      overtimeEpoch: Number(options.overtimeEpoch) || 0,
    },
  };
}

function createFakeClock(startMs) {
  let wallMs = startMs;
  let monotonicMs = 0;
  let nextId = 1;
  const timers = new Map();

  function runDueTimers() {
    let callbacks = 0;
    while (true) {
      const due = [...timers.values()]
        .filter((timer) => timer.at <= monotonicMs)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!due) return;
      if (++callbacks > 1000) throw new Error('Immediate timer callback loop');
      timers.delete(due.id);
      due.callback();
    }
  }

  return {
    now: () => wallMs,
    monotonicNow: () => monotonicMs,
    setTimeout(callback, delay) {
      const timer = {
        id: nextId,
        at: monotonicMs + delay,
        callback,
        unref() {},
      };
      nextId += 1;
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timers.delete(timer.id);
    },
    advance(deltaMs) {
      wallMs += deltaMs;
      monotonicMs += deltaMs;
      runDueTimers();
    },
    advanceWall(deltaMs) {
      wallMs += deltaMs;
    },
    resetMonotonic() {
      monotonicMs = 0;
      timers.clear();
    },
  };
}

module.exports = {
  createFixture,
  effectRule,
  fixedRule,
};
