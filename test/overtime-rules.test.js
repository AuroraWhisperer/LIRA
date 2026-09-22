'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MAX_OVERTIME_SECONDS, createOvertimeConsumer } = require('../src/overtime');
const { createFixture, effectRule, fixedRule } = require('./helpers/overtime-service-fixture');

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
    assert.equal(updates.filter((update) => update.reason === 'gift').length, 1);
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
    assert.equal(updates.filter((update) => update.reason === 'gift').length, 1);
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
      assert.equal(service.getSnapshot().effectiveRemainingMs, expectedSeconds * 1000, giftId);
      assert.equal(fixture.getSettlement(event.giftEventId).status, 'applied', giftId);
    }

    const multiMonth = fixture.insertFinalGift({
      giftId: '10003',
      num: 12,
      overtimeEpoch: 1,
    });
    consumer.handle(multiMonth);
    expectedSeconds += 12;
    assert.equal(service.getSnapshot().effectiveRemainingMs, expectedSeconds * 1000);
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
    assert.deepEqual(JSON.parse(fixture.getSettlement(event.giftEventId).outcomes_json), {
      version: 2,
      selectedIndex: 1,
      selectedEffect: { operation: 'subtract', value: 30 },
      totalWeight: 3,
    });
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
    assert.deepEqual(JSON.parse(fixture.getSettlement(event.giftEventId).outcomes_json), {
      version: 3,
      quantity: 3,
      selectedIndexes: [0, 1, 0],
      totalWeight: 3,
    });
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
      assert.equal(service.getSnapshot().effectiveRemainingMs, expectedSeconds * 1000);
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

    assert.equal(service.getSnapshot().effectiveRemainingMs, MAX_OVERTIME_SECONDS * 1000);
    assert.equal(fixture.getSettlement(event.giftEventId).applied_delta_seconds > 0, true);
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
