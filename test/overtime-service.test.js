'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_OVERTIME_SECONDS,
  createOvertimeConsumer,
  createOvertimeService,
  validateBackground,
  validateRules,
  validateTimeInput
} = require('../src/overtime');
const {
  clearGiftData,
  closeDatabases,
  createDatabases,
  getSchemaVersions
} = require('../src/storage/database');

test('gift database v5 creates overtime tables and safe singleton defaults', () => {
  const fixture = createFixture();
  try {
    assert.equal(getSchemaVersions(fixture.db).giftDb, 5);
    const tables = new Set(
      fixture.db.giftDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        .map(row => row.name)
    );
    assert.equal(tables.has('overtime_machine_state'), true);
    assert.equal(tables.has('overtime_gift_rules'), true);
    assert.equal(tables.has('overtime_settlements'), true);

    const state = fixture.db.giftDb.prepare('SELECT * FROM overtime_machine_state WHERE id = 1').get();
    assert.equal(state.enabled, 0);
    assert.equal(state.enable_epoch, 0);
    assert.equal(state.initial_seconds, 0);
    assert.equal(state.remaining_ms, 0);
    assert.equal(state.status, 'paused');
    assert.equal(state.background_path, '');
    assert.equal(state.background_fit, 'cover');
    assert.equal(state.revision, 0);
  } finally {
    fixture.close();
  }
});

test('running time uses a monotonic anchor and pauses without further drift', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({ onUpdate: message => updates.push(message) });

  try {
    service.act('enable');
    service.setTime({ initialSeconds: 600, remainingSeconds: 600 });
    service.act('start');
    fixture.clock.advance(10_000);
    service.act('pause');

    assert.equal(service.getSnapshot().effectiveRemainingMs, 590_000);
    fixture.clock.advance(10_000);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 590_000);
    assert.equal(service.getSnapshot().status, 'paused');
    assert.deepEqual(updates.map(update => update.reason), ['manual', 'manual', 'manual', 'manual']);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('natural zero persists finished once and increments the revision', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({ onUpdate: message => updates.push(message) });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 2 });
    service.act('start');
    const before = service.getSnapshot().revision;
    fixture.clock.advance(2_000);

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.effectiveRemainingMs, 0);
    assert.equal(snapshot.status, 'finished');
    assert.equal(snapshot.revision, before + 1);
    assert.equal(updates.filter(update => update.reason === 'finished').length, 1);

    fixture.clock.advance(10_000);
    assert.equal(updates.filter(update => update.reason === 'finished').length, 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('enable epochs advance only on disabled to enabled transitions', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    assert.equal(service.getCurrentEpoch(), 0);
    service.act('enable');
    assert.equal(service.getCurrentEpoch(), 1);
    service.act('enable');
    assert.equal(service.getCurrentEpoch(), 1);
    service.act('disable');
    assert.equal(service.getCurrentEpoch(), 0);
    assert.equal(service.getSnapshot().status, 'disabled');
    service.act('enable');
    assert.equal(service.getCurrentEpoch(), 2);
    assert.equal(service.getSnapshot().status, 'paused');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('restart deducts offline elapsed time and never gains time after wall-clock rollback', () => {
  const fixture = createFixture();
  let service = fixture.createService();

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 100 });
    service.act('start');
    fixture.clock.advance(10_000);
    service.dispose();

    fixture.clock.resetMonotonic();
    fixture.clock.advanceWall(20_000);
    service = fixture.createService();
    assert.equal(service.getSnapshot().effectiveRemainingMs, 70_000);
    service.dispose();

    fixture.clock.resetMonotonic();
    fixture.clock.advanceWall(-60_000);
    service = fixture.createService();
    assert.equal(service.getSnapshot().effectiveRemainingMs, 70_000);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('time, background, and rules validation enforce server limits', () => {
  assert.deepEqual(validateTimeInput({ remainingSeconds: MAX_OVERTIME_SECONDS }), {
    remainingSeconds: MAX_OVERTIME_SECONDS
  });
  assert.throws(
    () => validateTimeInput({ remainingSeconds: MAX_OVERTIME_SECONDS + 1 }),
    /remainingSeconds/
  );
  assert.deepEqual(validateBackground({ path: '', fit: 'contain' }), { path: '', fit: 'contain' });
  assert.deepEqual(
    validateBackground({ path: '/img/overtime-machine/night.webp', fit: 'cover' }),
    { path: '/img/overtime-machine/night.webp', fit: 'cover' }
  );
  assert.throws(() => validateBackground({ path: '../secret', fit: 'cover' }), /path/);
  assert.throws(() => validateBackground({ path: 'https://example.test/a.png', fit: 'cover' }), /path/);

  const rules = validateRules([
    {
      giftId: '35521', giftName: '心动时刻', imagePath: '/img/bilibili-gifts/a.webp',
      mode: 'fixed', fixedSeconds: 300, enabled: true, sortOrder: 0
    },
    {
      giftId: '1', giftName: '盲盒', imagePath: '', mode: 'random', enabled: false,
      outcomes: [{ seconds: 60, weight: 2 }, { seconds: -30, weight: 1 }], sortOrder: 1
    }
  ]);
  assert.equal(rules[0].fixedSeconds, 300);
  assert.deepEqual(rules[1].outcomes, [{ seconds: 60, weight: 2 }, { seconds: -30, weight: 1 }]);
  assert.throws(
    () => validateRules(Array.from({ length: 9 }, (_, index) => ({
      giftId: String(index), mode: 'fixed', fixedSeconds: 1, enabled: true
    }))),
    /enabled rules/
  );
});

test('final gift groups apply a fixed rule once without multiplying by quantity', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({ onUpdate: update => updates.push(update) });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([fixedRule('gift-a', 300)]);
    const event = fixture.insertFinalGift({ giftId: 'gift-a', num: 100, overtimeEpoch: 1 });

    consumer.handle(event);
    consumer.handle(event);

    assert.equal(service.getSnapshot().effectiveRemainingMs, 420_000);
    const settlement = fixture.getSettlement(event.giftEventId);
    assert.equal(settlement.status, 'applied');
    assert.equal(settlement.quantity, 100);
    assert.equal(settlement.requested_delta_seconds, 300);
    assert.equal(settlement.applied_delta_seconds, 300);
    assert.equal(fixture.countSettlements(event.giftEventId), 1);
    assert.equal(updates.filter(update => update.reason === 'gift').length, 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('random gift groups persist one weighted result and never redraw', () => {
  const fixture = createFixture();
  let draws = 0;
  const service = fixture.createService({
    randomInt(totalWeight) {
      draws += 1;
      assert.equal(totalWeight, 3);
      return 2;
    }
  });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([{
      giftId: 'blind', giftName: 'Blind', imagePath: '', mode: 'random',
      outcomes: [{ seconds: 60, weight: 2 }, { seconds: -30, weight: 1 }],
      enabled: true, sortOrder: 0
    }]);
    const event = fixture.insertFinalGift({ giftId: 'blind', overtimeEpoch: 1 });

    consumer.handle(event);
    consumer.handle(event);

    assert.equal(draws, 1);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 90_000);
    assert.deepEqual(JSON.parse(fixture.getSettlement(event.giftEventId).outcomes_json), {
      version: 1,
      selectedIndex: 1,
      selectedSeconds: -30,
      totalWeight: 3
    });
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('negative gifts clamp at zero and a positive gift restarts a finished clock', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([fixedRule('minus', -300), fixedRule('plus', 60, 1)]);
    const minus = fixture.insertFinalGift({ giftId: 'minus', overtimeEpoch: 1 });
    consumer.handle(minus);

    assert.equal(service.getSnapshot().effectiveRemainingMs, 0);
    assert.equal(service.getSnapshot().status, 'finished');
    assert.equal(fixture.getSettlement(minus.giftEventId).applied_delta_seconds, -120);

    const plus = fixture.insertFinalGift({ giftId: 'plus', overtimeEpoch: 1 });
    consumer.handle(plus);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 60_000);
    assert.equal(service.getSnapshot().status, 'running');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('progress creates pending, disable ignores it, and old epochs never reopen it', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.replaceRules([fixedRule('gift-a', 60)]);
    const progress = fixture.insertProgressGift({ giftId: 'gift-a', overtimeEpoch: 1 });
    consumer.handle(progress);
    assert.equal(fixture.getSettlement(progress.giftEventId).status, 'pending');

    service.act('disable');
    assert.equal(fixture.getSettlement(progress.giftEventId).status, 'ignored');
    service.act('enable');
    fixture.finalizeGift(progress.giftEventId);
    consumer.handle({ ...progress, phase: 'final' });

    assert.equal(service.getSnapshot().effectiveRemainingMs, 0);
    assert.equal(fixture.getSettlement(progress.giftEventId).status, 'ignored');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('startup compensation settles an eligible final event missing its checkpoint', () => {
  const fixture = createFixture();
  let service = fixture.createService();

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 10 });
    service.replaceRules([fixedRule('gift-a', 30)]);
    const event = fixture.insertFinalGift({ giftId: 'gift-a', overtimeEpoch: 1 });
    service.dispose();

    service = fixture.createService();
    assert.equal(service.getSnapshot().effectiveRemainingMs, 40_000);
    assert.equal(fixture.getSettlement(event.giftEventId).status, 'applied');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('a failed settlement rolls back time and retries after one second', () => {
  const fixture = createFixture();
  let attempts = 0;
  const service = fixture.createService({
    randomInt() {
      attempts += 1;
      if (attempts === 1) throw new Error('simulated random failure');
      return 0;
    }
  });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 10 });
    service.replaceRules([{
      giftId: 'blind', giftName: 'Blind', imagePath: '', mode: 'random',
      outcomes: [{ seconds: 60, weight: 1 }, { seconds: -30, weight: 1 }],
      enabled: true, sortOrder: 0
    }]);
    const event = fixture.insertFinalGift({ giftId: 'blind', overtimeEpoch: 1 });

    assert.throws(() => consumer.handle(event), /simulated random failure/);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 10_000);
    assert.equal(fixture.getSettlement(event.giftEventId).status, 'pending');
    assert.equal(fixture.getSettlement(event.giftEventId).retry_count, 1);

    fixture.clock.advance(1_000);
    assert.equal(attempts, 2);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 70_000);
    assert.equal(fixture.getSettlement(event.giftEventId).status, 'applied');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('clearing gifts also clears settlements while preserving overtime configuration', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 10 });
    service.replaceRules([fixedRule('gift-a', 30)]);
    const event = fixture.insertFinalGift({ giftId: 'gift-a', overtimeEpoch: 1 });
    consumer.handle(event);

    clearGiftData(fixture.db.giftDb);

    assert.equal(fixture.db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 0);
    assert.equal(
      fixture.db.giftDb.prepare('SELECT COUNT(*) AS count FROM overtime_settlements').get().count,
      0
    );
    assert.equal(service.getSnapshot().enabled, true);
    assert.equal(service.getSnapshot().rules.length, 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});

function createFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-overtime-'));
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
        ...options
      });
    },
    insertProgressGift(options = {}) {
      return insertGift(db.giftDb, clock.now(), { ...options, phase: 'progress' });
    },
    insertFinalGift(options = {}) {
      return insertGift(db.giftDb, clock.now(), { ...options, phase: 'final' });
    },
    finalizeGift(id) {
      db.giftDb.prepare(`
        UPDATE gift_events SET detection_status = 'final', finalized_at_ms = ? WHERE id = ?
      `).run(clock.now(), id);
    },
    getSettlement(id) {
      return db.giftDb.prepare(
        'SELECT * FROM overtime_settlements WHERE gift_event_id = ?'
      ).get(id) || null;
    },
    countSettlements(id) {
      return Number(db.giftDb.prepare(
        'SELECT COUNT(*) AS count FROM overtime_settlements WHERE gift_event_id = ?'
      ).get(id)?.count) || 0;
    },
    close() {
      closeDatabases(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

function fixedRule(giftId, fixedSeconds, sortOrder = 0) {
  return {
    giftId, giftName: giftId, imagePath: '', mode: 'fixed', fixedSeconds,
    enabled: true, sortOrder
  };
}

function insertGift(giftDb, nowMs, options) {
  const phase = options.phase || 'final';
  const createdAt = new Date(nowMs).toISOString();
  const giftId = String(options.giftId || 'gift-a');
  const num = Number(options.num) || 1;
  const result = giftDb.prepare(`
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name, uid, user_name, num,
      unit_price, total_price, coin_type, detection_status,
      first_detected_at_ms, last_platform_at_ms, finalized_at_ms,
      gift_stats_eligible, gift_stats_delivered, overtime_epoch,
      status, raw_json, created_at, updated_at
    ) VALUES (?, 'SEND_GIFT', ?, ?, '1', 'viewer', ?, 0.1, ?, 'gold', ?, ?, ?, ?,
      0, 0, ?, 'active', '', ?, ?)
  `).run(
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
    createdAt
  );
  const id = Number(result.lastInsertRowid);
  return {
    phase,
    giftEventId: id,
    gift: {
      giftId,
      giftName: options.giftName || giftId,
      num,
      totalPrice: num * 0.1,
      createdAt,
      updatedAt: createdAt
    },
    eligibility: { giftStatistics: false, overtimeEpoch: Number(options.overtimeEpoch) || 0 }
  };
}

function createFakeClock(startMs) {
  let wallMs = startMs;
  let monotonicMs = 0;
  let nextId = 1;
  const timers = new Map();

  function runDueTimers() {
    while (true) {
      const due = [...timers.values()]
        .filter(timer => timer.at <= monotonicMs)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!due) return;
      timers.delete(due.id);
      due.callback();
    }
  }

  return {
    now: () => wallMs,
    monotonicNow: () => monotonicMs,
    setTimeout(callback, delay) {
      const timer = { id: nextId, at: monotonicMs + delay, callback, unref() {} };
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
    }
  };
}
