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
  validateTimeInput,
} = require('../src/overtime');
const {
  clearGiftData,
  closeDatabases,
  createDatabases,
  getSchemaVersions,
} = require('../src/storage/database');

test('gift database v7 creates overtime tables and safe singleton defaults', () => {
  const fixture = createFixture();
  try {
    assert.equal(getSchemaVersions(fixture.db).giftDb, 7);
    const tables = new Set(
      fixture.db.giftDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    assert.equal(tables.has('overtime_machine_state'), true);
    assert.equal(tables.has('overtime_gift_rules'), true);
    assert.equal(tables.has('overtime_settlements'), true);

    const state = fixture.db.giftDb
      .prepare('SELECT * FROM overtime_machine_state WHERE id = 1')
      .get();
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

test('gift database v7 preserves v5 overtime state while widening its bounds', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-overtime-migration-'),
  );
  let db = createDatabases({ dataDir });
  try {
    db.giftDb.exec(`
      DROP TABLE overtime_machine_state;
      CREATE TABLE overtime_machine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        enable_epoch INTEGER NOT NULL DEFAULT 0 CHECK (enable_epoch >= 0),
        initial_seconds INTEGER NOT NULL DEFAULT 0 CHECK (initial_seconds BETWEEN 0 AND 3599999),
        remaining_ms INTEGER NOT NULL DEFAULT 0 CHECK (remaining_ms BETWEEN 0 AND 3599999000),
        anchor_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (anchor_at_ms >= 0),
        status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'running', 'finished')),
        background_path TEXT NOT NULL DEFAULT '',
        background_fit TEXT NOT NULL DEFAULT 'cover' CHECK (background_fit IN ('cover', 'contain', 'fill')),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        updated_at TEXT NOT NULL
      );
      INSERT INTO overtime_machine_state VALUES (
        1, 1, 7, 3600, 2700000, 1234, 'paused', '/img/overtime-machine/night.webp',
        'contain', 9, '2026-08-14T00:00:00.000Z'
      );
      UPDATE schema_version SET version = 5 WHERE key = 'gift_db';
    `);
    closeDatabases(db);

    db = createDatabases({ dataDir });
    const state = db.giftDb
      .prepare('SELECT * FROM overtime_machine_state WHERE id = 1')
      .get();
    assert.equal(getSchemaVersions(db).giftDb, 7);
    assert.equal(state.enabled, 1);
    assert.equal(state.enable_epoch, 7);
    assert.equal(state.remaining_ms, 2_700_000);
    assert.equal(state.background_fit, 'contain');
    db.giftDb
      .prepare(
        'UPDATE overtime_machine_state SET remaining_ms = ? WHERE id = 1',
      )
      .run(MAX_OVERTIME_SECONDS * 1000);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('running time uses a monotonic anchor and pauses without further drift', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (message) => updates.push(message),
  });

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
    assert.deepEqual(
      updates.map((update) => update.reason),
      ['manual', 'manual', 'manual', 'manual'],
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('natural zero persists finished once and increments the revision', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (message) => updates.push(message),
  });

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
    assert.equal(
      updates.filter((update) => update.reason === 'finished').length,
      1,
    );

    fixture.clock.advance(10_000);
    assert.equal(
      updates.filter((update) => update.reason === 'finished').length,
      1,
    );
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
  assert.equal(MAX_OVERTIME_SECONDS, 9_999 * 365 * 24 * 60 * 60);
  assert.deepEqual(
    validateTimeInput({ remainingSeconds: MAX_OVERTIME_SECONDS }),
    {
      remainingSeconds: MAX_OVERTIME_SECONDS,
    },
  );
  assert.throws(
    () => validateTimeInput({ remainingSeconds: MAX_OVERTIME_SECONDS + 1 }),
    /remainingSeconds/,
  );
  assert.deepEqual(validateBackground({ path: '', fit: 'contain' }), {
    path: '',
    fit: 'contain',
  });
  assert.deepEqual(
    validateBackground({
      path: '/img/overtime-machine/night.webp',
      fit: 'cover',
    }),
    { path: '/img/overtime-machine/night.webp', fit: 'cover' },
  );
  assert.throws(
    () => validateBackground({ path: '../secret', fit: 'cover' }),
    /path/,
  );
  assert.throws(
    () =>
      validateBackground({ path: 'https://example.test/a.png', fit: 'cover' }),
    /path/,
  );

  const rules = validateRules([
    {
      giftId: '35521',
      giftName: '心动时刻',
      imagePath: '/img/bilibili-gifts/a.webp',
      mode: 'fixed',
      fixedSeconds: 300,
      enabled: true,
      sortOrder: 0,
    },
    {
      giftId: '1',
      giftName: '盲盒',
      imagePath: '',
      mode: 'random',
      enabled: false,
      outcomes: [
        { seconds: 60, weight: 2 },
        { seconds: -30, weight: 1 },
      ],
      sortOrder: 1,
    },
    {
      giftId: '2',
      giftName: '翻倍',
      imagePath: '',
      mode: 'fixed',
      enabled: false,
      fixedEffect: { operation: 'multiply', value: 8 },
      sortOrder: 2,
    },
  ]);
  assert.equal(rules[0].fixedSeconds, 300);
  assert.deepEqual(rules[0].fixedEffect, { operation: 'add', value: 300 });
  assert.deepEqual(rules[1].outcomes, [
    { operation: 'add', value: 60, weight: 2 },
    { operation: 'subtract', value: 30, weight: 1 },
  ]);
  assert.deepEqual(rules[2].fixedEffect, { operation: 'multiply', value: 8 });
  assert.equal(rules[2].fixedSeconds, null);
  assert.deepEqual(
    rules.map((rule) => rule.quantityMode),
    ['group', 'group', 'group'],
  );
  const guardRule = validateRules([
    {
      giftId: 'guard-1',
      mode: 'fixed',
      imagePath: '/img/admin/gifts/bilibili-guard-governor.webp',
      fixedSeconds: 300,
    },
  ]);
  assert.equal(
    guardRule[0].imagePath,
    '/img/admin/gifts/bilibili-guard-governor.webp',
  );
  const itemRule = validateRules([
    {
      giftId: 'quantity-item',
      mode: 'fixed',
      quantityMode: 'item',
      fixedSeconds: 1,
    },
  ]);
  assert.equal(itemRule[0].quantityMode, 'item');
  const displayRule = validateRules([
    {
      giftId: 'display-gift',
      mode: 'display',
      displayText: '谢谢支持',
      enabled: true,
    },
  ]);
  assert.equal(displayRule[0].displayText, '谢谢支持');
  assert.throws(
    () =>
      validateRules([
        { giftId: 'too-long', mode: 'display', displayText: '七个文字超长度' },
      ]),
    /displayText/,
  );
  assert.throws(
    () =>
      validateRules([
        { giftId: 'control', mode: 'display', displayText: '好\n' },
      ]),
    /displayText/,
  );
  assert.throws(
    () =>
      validateRules([
        {
          giftId: 'bad-quantity-mode',
          mode: 'fixed',
          quantityMode: 'price',
          fixedSeconds: 1,
        },
      ]),
    /quantityMode/,
  );
  assert.throws(
    () =>
      validateRules([
        {
          giftId: 'bad-factor',
          mode: 'fixed',
          fixedEffect: { operation: 'divide', value: 1 },
        },
      ]),
    /value/,
  );
  assert.throws(
    () =>
      validateRules(
        Array.from({ length: 9 }, (_, index) => ({
          giftId: String(index),
          mode: 'fixed',
          fixedSeconds: 1,
          enabled: true,
        })),
      ),
    /enabled rules/,
  );
});

test('group quantity mode applies a fixed rule once for the finalized combo', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (update) => updates.push(update),
  });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([fixedRule('gift-a', 300)]);
    const event = fixture.insertFinalGift({
      giftId: 'gift-a',
      num: 100,
      overtimeEpoch: 1,
    });

    consumer.handle(event);
    consumer.handle(event);

    assert.equal(service.getSnapshot().effectiveRemainingMs, 420_000);
    const settlement = fixture.getSettlement(event.giftEventId);
    assert.equal(settlement.status, 'applied');
    assert.equal(settlement.quantity, 100);
    assert.equal(settlement.requested_delta_seconds, 300);
    assert.equal(settlement.applied_delta_seconds, 300);
    assert.equal(fixture.countSettlements(event.giftEventId), 1);
    assert.equal(
      updates.filter((update) => update.reason === 'gift').length,
      1,
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('item quantity mode applies a fixed rule once per gift in the finalized combo', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([fixedRule('gift-a', 300, 0, 'item')]);
    const event = fixture.insertFinalGift({
      giftId: 'gift-a',
      num: 100,
      overtimeEpoch: 1,
    });

    consumer.handle(event);
    consumer.handle(event);

    assert.equal(service.getSnapshot().effectiveRemainingMs, 30_120_000);
    const settlement = fixture.getSettlement(event.giftEventId);
    assert.equal(settlement.quantity, 100);
    assert.equal(settlement.requested_delta_seconds, 30_000);
    assert.equal(settlement.applied_delta_seconds, 30_000);
    assert.equal(fixture.countSettlements(event.giftEventId), 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('display gift settlement keeps time unchanged and remains idempotent', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (update) => updates.push(update),
  });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([
      {
        giftId: 'display-gift',
        giftName: '展示礼物',
        imagePath: '',
        mode: 'display',
        displayText: '谢谢支持',
        quantityMode: 'item',
        enabled: true,
        sortOrder: 0,
      },
    ]);
    const event = fixture.insertFinalGift({
      giftId: 'display-gift',
      num: 100,
      overtimeEpoch: 1,
    });

    consumer.handle(event);
    consumer.handle(event);

    assert.equal(service.getSnapshot().effectiveRemainingMs, 120_000);
    assert.equal(service.getSnapshot().rules[0].displayText, '谢谢支持');
    const settlement = fixture.getSettlement(event.giftEventId);
    assert.equal(settlement.status, 'applied');
    assert.equal(settlement.requested_delta_seconds, 0);
    assert.equal(settlement.applied_delta_seconds, 0);
    assert.equal(fixture.countSettlements(event.giftEventId), 1);
    assert.equal(
      updates.filter((update) => update.reason === 'gift').length,
      1,
    );
    assert.equal(updates.at(-1).adjustment.displayText, '谢谢支持');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('guard purchases and room gift aliases share the three canonical guard rules', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.replaceRules([
      fixedRule('guard-1', 100, 0, 'item'),
      fixedRule('guard-2', 10, 1, 'item'),
      fixedRule('guard-3', 1, 2, 'item'),
    ]);

    let expectedSeconds = 0;
    for (const [giftId, seconds] of [
      ['guard-1', 100],
      ['10001', 100],
      ['33909', 100],
      ['34639', 100],
      ['guard-2', 10],
      ['10002', 10],
      ['33908', 10],
      ['34638', 10],
      ['guard-3', 1],
      ['10003', 1],
      ['34637', 1],
      ['33972', 1],
      ['33978', 1],
      ['34636', 1],
    ]) {
      const event = fixture.insertFinalGift({ giftId, overtimeEpoch: 1 });
      consumer.handle(event);
      expectedSeconds += seconds;
      assert.equal(
        service.getSnapshot().effectiveRemainingMs,
        expectedSeconds * 1000,
        giftId,
      );
      assert.equal(
        fixture.getSettlement(event.giftEventId).status,
        'applied',
        giftId,
      );
    }

    const multiMonth = fixture.insertFinalGift({
      giftId: '10003',
      num: 12,
      overtimeEpoch: 1,
    });
    consumer.handle(multiMonth);
    expectedSeconds += 12;
    assert.equal(
      service.getSnapshot().effectiveRemainingMs,
      expectedSeconds * 1000,
    );
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
    },
  });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([
      {
        giftId: 'blind',
        giftName: 'Blind',
        imagePath: '',
        mode: 'random',
        outcomes: [
          { seconds: 60, weight: 2 },
          { seconds: -30, weight: 1 },
        ],
        enabled: true,
        sortOrder: 0,
      },
    ]);
    const event = fixture.insertFinalGift({
      giftId: 'blind',
      overtimeEpoch: 1,
    });

    consumer.handle(event);
    consumer.handle(event);

    assert.equal(draws, 1);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 90_000);
    assert.deepEqual(
      JSON.parse(fixture.getSettlement(event.giftEventId).outcomes_json),
      {
        version: 2,
        selectedIndex: 1,
        selectedEffect: { operation: 'subtract', value: 30 },
        totalWeight: 3,
      },
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('item quantity mode draws one random result per gift and persists every selected index', () => {
  const fixture = createFixture();
  const draws = [0, 2, 0];
  const service = fixture.createService({ randomInt: () => draws.shift() });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 120 });
    service.replaceRules([
      {
        giftId: 'blind',
        giftName: 'Blind',
        imagePath: '',
        mode: 'random',
        quantityMode: 'item',
        outcomes: [
          { seconds: 60, weight: 2 },
          { seconds: -30, weight: 1 },
        ],
        enabled: true,
        sortOrder: 0,
      },
    ]);
    const event = fixture.insertFinalGift({
      giftId: 'blind',
      num: 3,
      overtimeEpoch: 1,
    });

    consumer.handle(event);
    consumer.handle(event);

    assert.equal(draws.length, 0);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 210_000);
    assert.deepEqual(
      JSON.parse(fixture.getSettlement(event.giftEventId).outcomes_json),
      {
        version: 3,
        quantity: 3,
        selectedIndexes: [0, 1, 0],
        totalWeight: 3,
      },
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('gift rules apply add, subtract, multiply, divide, and clear in constant time', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (update) => updates.push(update),
  });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 125 });
    service.replaceRules([
      effectRule('multiply', 'multiply', 3, 0),
      effectRule('divide', 'divide', 2, 1),
      effectRule('subtract', 'subtract', 20, 2),
      effectRule('add', 'add', 10, 3),
      effectRule('clear', 'clear', 0, 4),
    ]);

    for (const [giftId, expectedSeconds] of [
      ['multiply', 375],
      ['divide', 187],
      ['subtract', 167],
      ['add', 177],
      ['clear', 0],
    ]) {
      consumer.handle(fixture.insertFinalGift({ giftId, overtimeEpoch: 1 }));
      assert.equal(
        service.getSnapshot().effectiveRemainingMs,
        expectedSeconds * 1000,
      );
    }

    const giftUpdates = updates.filter((update) => update.reason === 'gift');
    assert.deepEqual(
      giftUpdates.map((update) => update.adjustment.effect.operation),
      ['multiply', 'divide', 'subtract', 'add', 'clear'],
    );
    assert.equal(service.getSnapshot().status, 'finished');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('multiplication saturates at 9,999 years without overflowing storage', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({
      remainingSeconds: Math.floor(MAX_OVERTIME_SECONDS / 2) + 1,
    });
    service.replaceRules([effectRule('multiply', 'multiply', 3)]);
    const event = fixture.insertFinalGift({
      giftId: 'multiply',
      overtimeEpoch: 1,
    });
    consumer.handle(event);

    assert.equal(
      service.getSnapshot().effectiveRemainingMs,
      MAX_OVERTIME_SECONDS * 1000,
    );
    assert.equal(
      fixture.getSettlement(event.giftEventId).applied_delta_seconds > 0,
      true,
    );
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
    const minus = fixture.insertFinalGift({
      giftId: 'minus',
      overtimeEpoch: 1,
    });
    consumer.handle(minus);

    assert.equal(service.getSnapshot().effectiveRemainingMs, 0);
    assert.equal(service.getSnapshot().status, 'finished');
    assert.equal(
      fixture.getSettlement(minus.giftEventId).applied_delta_seconds,
      -120,
    );

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
    const progress = fixture.insertProgressGift({
      giftId: 'gift-a',
      overtimeEpoch: 1,
    });
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
    const event = fixture.insertFinalGift({
      giftId: 'gift-a',
      overtimeEpoch: 1,
    });
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
    },
  });
  const consumer = createOvertimeConsumer({ service });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 10 });
    service.replaceRules([
      {
        giftId: 'blind',
        giftName: 'Blind',
        imagePath: '',
        mode: 'random',
        outcomes: [
          { seconds: 60, weight: 1 },
          { seconds: -30, weight: 1 },
        ],
        enabled: true,
        sortOrder: 0,
      },
    ]);
    const event = fixture.insertFinalGift({
      giftId: 'blind',
      overtimeEpoch: 1,
    });

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
    const event = fixture.insertFinalGift({
      giftId: 'gift-a',
      overtimeEpoch: 1,
    });
    consumer.handle(event);

    clearGiftData(fixture.db.giftDb);

    assert.equal(
      fixture.db.giftDb
        .prepare('SELECT COUNT(*) AS count FROM gift_events')
        .get().count,
      0,
    );
    assert.equal(
      fixture.db.giftDb
        .prepare('SELECT COUNT(*) AS count FROM overtime_settlements')
        .get().count,
      0,
    );
    assert.equal(service.getSnapshot().enabled, true);
    assert.equal(service.getSnapshot().rules.length, 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});

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
    while (true) {
      const due = [...timers.values()]
        .filter((timer) => timer.at <= monotonicMs)
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
