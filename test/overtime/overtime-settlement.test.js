'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { giftVariantId } = require('../../src/shared/gift-identity');
const { createOvertimeConsumer } = require('../../src/overtime');
const { createOvertimeStore } = require('../../src/overtime/overtime-store');
const { clearGiftData } = require('../../src/storage/database');
const { createGiftProjectionService } = require('../../src/bilibili/gift');
const { normalizeProcessedGiftEvent } = require('../../src/shared/processed-gift-contract');
const { createFixture, fixedRule } = require('../helpers/overtime-service-fixture');
const { createGiftSource, makeProcessedGiftEvent } = require('../helpers/processed-gift-fixture');

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

test('startup compensation drains more than one batch of final events without checkpoints', () => {
  const fixture = createFixture();
  let service = fixture.createService();
  try {
    service.act('enable');
    service.replaceRules([fixedRule('gift-a', 1)]);
    service.dispose();
    const events = Array.from({ length: 250 }, () => fixture.insertFinalGift({ giftId: 'gift-a', overtimeEpoch: 1 }));
    const oldEpoch = fixture.insertFinalGift({ giftId: 'gift-a', overtimeEpoch: 0 });
    const progress = fixture.insertProgressGift({ giftId: 'gift-a', overtimeEpoch: 1 });
    service = fixture.createService();
    const settledCount = () =>
      fixture.db.giftDb.prepare('SELECT COUNT(*) AS count FROM overtime_settlements').get().count;
    assert.equal(settledCount(), 100, 'startup yields after its first bounded batch');
    fixture.clock.advance(0);
    assert.equal(settledCount(), 250, 'the remaining batches recover without a new gift or restart');
    assert.equal(service.getSnapshot().effectiveRemainingMs, 250_000);
    assert.equal(fixture.getSettlement(oldEpoch.giftEventId), null);
    assert.equal(fixture.getSettlement(progress.giftEventId), null);
    for (const event of events) assert.equal(service.finalizeGift(event), false);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 250_000);
    assert.equal(fixture.getSettlement(events.at(-1).giftEventId).status, 'applied');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('unobserved recovery backlog keeps its retry delay while checkpoint writes fail', () => {
  const fixture = createFixture();
  let service = fixture.createService();
  try {
    service.act('enable');
    service.replaceRules([fixedRule('gift-a', 1)]);
    service.dispose();
    const event = fixture.insertFinalGift({ giftId: 'gift-a', overtimeEpoch: 1 });
    const store = createOvertimeStore(fixture.db.giftDb);
    const observe = store.observeGift;
    let attempts = 0;
    let blocked = true;
    store.observeGift = (...args) => {
      attempts++;
      if (blocked) throw new Error('synthetic checkpoint unavailable');
      return observe(...args);
    };
    service = fixture.createService({ store });
    assert.equal(attempts, 1);
    fixture.clock.advance(999);
    assert.equal(attempts, 1);
    blocked = false;
    fixture.clock.advance(1);
    assert.equal(attempts, 2);
    assert.equal(fixture.getSettlement(event.giftEventId).status, 'applied');
  } finally {
    service.dispose();
    fixture.close();
  }
});

for (const pendingProgress of [false, true]) {
  test(`a failed settlement rolls back and retries with pending progress=${pendingProgress}`, () => {
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
      if (pendingProgress) consumer.handle(fixture.insertProgressGift({ giftId: 'blind', overtimeEpoch: 1 }));
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
}

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

    const timestamp = new Date().toISOString();
    const sourceId = fixture.db.giftDb
      .prepare(
        `
        INSERT INTO gift_sources (source_key, created_at, updated_at)
        VALUES (?, ?, ?)
      `,
      )
      .run('a'.repeat(64), timestamp, timestamp).lastInsertRowid;
    fixture.db.giftDb
      .prepare('INSERT INTO gift_sync_state (source_id, updated_at) VALUES (?, ?)')
      .run(sourceId, timestamp);
    fixture.db.giftDb.prepare('UPDATE gift_events SET source_id = ? WHERE id = ?').run(sourceId, event.giftEventId);

    clearGiftData(fixture.db.giftDb, { sourceId: Number(sourceId) });

    assert.equal(fixture.db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 0);
    assert.equal(fixture.db.giftDb.prepare('SELECT COUNT(*) AS count FROM overtime_settlements').get().count, 0);
    assert.equal(service.getSnapshot().enabled, true);
    assert.equal(service.getSnapshot().rules.length, 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('same-ID names and prices settle only their bound identity, including replay and restart', () => {
  const fixture = createFixture();
  let service = fixture.createService();
  const rules = [
    ['旧礼物', 1000, 30],
    ['新礼物', 1000, 60],
    ['新礼物', 2000, 90],
  ].map(([name, priceRaw, seconds], index) => {
    const giftIdentity = { priceRaw, coinType: 'gold', bagGift: false };
    giftIdentity.variantId = giftVariantId({
      ...giftIdentity,
      giftId: '34832',
      name,
    });
    return {
      ...fixedRule('34832', seconds, index),
      giftName: name,
      giftIdentity,
    };
  });
  try {
    service.act('enable');
    service.replaceRules(rules);
    assert.equal(service.getSnapshot().rules.length, 3);
    let expected = 0;
    for (const rule of rules) {
      const event = fixture.insertFinalGift({
        giftId: rule.giftId,
        giftName: rule.giftName,
        giftVariantId: rule.giftIdentity.variantId,
        overtimeEpoch: 1,
      });
      assert.equal(service.finalizeGift(event), true);
      expected += rule.fixedSeconds * 1000;
      assert.equal(service.getSnapshot().effectiveRemainingMs, expected);
      assert.equal(service.finalizeGift(event), false);
      assert.deepEqual(
        JSON.parse(fixture.getSettlement(event.giftEventId).rule_snapshot_json).giftIdentity,
        rule.giftIdentity,
      );
    }
    const unknown = fixture.insertFinalGift({
      giftId: '34832',
      giftName: '新礼物',
      overtimeEpoch: 1,
    });
    assert.equal(service.finalizeGift(unknown), false);
    assert.equal(fixture.getSettlement(unknown.giftEventId).status, 'ignored');
    service.dispose();
    service = fixture.createService();
    assert.equal(service.getSnapshot().rules.length, 3);
    assert.equal(service.getSnapshot().effectiveRemainingMs, expected);
    assert.throws(() => service.replaceRules([rules[0], rules[0]]), /duplicate/);
    assert.throws(() => service.replaceRules([{ ...rules[0], giftName: '伪造名字' }]), /礼物身份/);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('legacy numeric rules retain effects but need reselection, and ignored history stays ignored', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  try {
    service.act('enable');
    service.replaceRules([{ ...fixedRule('34832', -45), giftName: '旧礼物' }]);
    const oldRule = service.getSnapshot().rules[0];
    assert.equal(oldRule.bindingStatus, 'needs-selection');
    assert.equal(oldRule.fixedEffect.value, 45);
    service.setTime({ remainingSeconds: 200 });
    const identity = { priceRaw: 1000, coinType: 'gold', bagGift: false };
    identity.variantId = giftVariantId({
      ...identity,
      giftId: '34832',
      name: '新礼物',
    });
    const ignored = fixture.insertFinalGift({
      giftId: '34832',
      giftName: '新礼物',
      giftVariantId: identity.variantId,
      overtimeEpoch: 1,
    });
    assert.equal(service.finalizeGift(ignored), false);
    service.replaceRules([{ ...oldRule, giftName: '新礼物', giftIdentity: identity }]);
    assert.equal(service.getSnapshot().rules[0].bindingStatus, 'bound');
    assert.equal(service.finalizeGift(ignored), false);
    const next = fixture.insertFinalGift({
      giftId: '34832',
      giftName: '新礼物',
      giftVariantId: identity.variantId,
      overtimeEpoch: 1,
    });
    assert.equal(service.finalizeGift(next), true);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 155000);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('1000 distinct final gifts and their replays settle once with one countdown timer', (t) => {
  const fixture = createFixture();
  const timers = new Set();
  let peakTimers = 0;
  const service = fixture.createService({
    setTimeout(callback, delay) {
      const timer = fixture.clock.setTimeout(callback, delay);
      timers.add(timer);
      peakTimers = Math.max(peakTimers, timers.size);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
      fixture.clock.clearTimeout(timer);
    },
  });
  const projection = createGiftProjectionService(
    { db: fixture.db, settings: () => ({}) },
    {
      getOvertimeEpoch: service.getCurrentEpoch,
      onGiftFinalized: (row) => service.finalizeGift({ giftEventId: row.id }),
    },
  );
  t.after(() => {
    projection.dispose();
    service.dispose();
    fixture.close();
  });
  service.act('enable');
  service.setTime({ remainingSeconds: 10 });
  service.act('start');
  service.replaceRules([{ giftId: 'guard-3', giftName: '舰长', mode: 'fixed', fixedSeconds: 1, enabled: true }]);
  const source = createGiftSource(fixture.db.giftDb);
  for (let index = 0; index < 1000; index++) {
    const event = makeProcessedGiftEvent(
      { giftId: '10003', giftName: '舰长' },
      {
        eventId: `pressure-${index}`,
        cursor: index + 1,
      },
    );
    normalizeProcessedGiftEvent(event);
    projection.importProcessedEvent(event, source);
    projection.importProcessedEvent(event, source);
  }
  assert.equal(fixture.db.giftDb.prepare('SELECT COUNT(*) AS count FROM overtime_settlements').get().count, 1000);
  assert.equal(service.getSnapshot().effectiveRemainingMs, 1_010_000);
  assert.equal(peakTimers, 1);
  assert.equal(timers.size, 1);
  projection.dispose();
  service.dispose();
  assert.equal(timers.size, 0);
});
