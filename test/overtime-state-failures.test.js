'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createFixture } = require('./helpers/overtime-service-fixture');

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

for (const scenario of [
  {
    name: 'enable',
    status: 'disabled',
    run: (service) => service.act('enable'),
    expected: { enabled: true, status: 'paused', effectiveRemainingMs: 60_000 },
  },
  {
    name: 'disable',
    status: 'running',
    run: (service) => service.act('disable'),
    expected: {
      enabled: false,
      status: 'disabled',
      effectiveRemainingMs: 54_000,
    },
  },
  {
    name: 'start',
    status: 'paused',
    run: (service) => service.act('start'),
    expected: { status: 'running', effectiveRemainingMs: 60_000 },
  },
  {
    name: 'pause',
    status: 'running',
    run: (service) => service.act('pause'),
    expected: { status: 'paused', effectiveRemainingMs: 54_000 },
  },
  {
    name: 'reset',
    status: 'running',
    run: (service) => service.act('reset'),
    expected: { status: 'paused', effectiveRemainingMs: 120_000 },
  },
  {
    name: 'initial time',
    status: 'running',
    run: (service) => service.setTime({ initialSeconds: 180 }),
    expected: {
      initialSeconds: 180,
      status: 'running',
      effectiveRemainingMs: 54_000,
    },
  },
  {
    name: 'remaining time',
    status: 'running',
    run: (service) =>
      service.setTime({ initialSeconds: 180, remainingSeconds: 45 }),
    expected: {
      initialSeconds: 180,
      status: 'paused',
      effectiveRemainingMs: 45_000,
    },
  },
  {
    name: 'zero time',
    status: 'running',
    run: (service) => service.setTime({ remainingSeconds: 0 }),
    expected: { status: 'finished', effectiveRemainingMs: 0 },
  },
  {
    name: 'background',
    status: 'running',
    reason: 'config',
    run: (service) =>
      service.setBackground({
        path: '/img/overtime-machine/night.webp',
        fit: 'contain',
      }),
    expected: {
      background: { path: '/img/overtime-machine/night.webp', fit: 'contain' },
      status: 'running',
      effectiveRemainingMs: 54_000,
    },
  },
]) {
  test(`${scenario.name} save failure preserves the committed state and allows retry`, () => {
    const fixture = createFixture();
    const updates = [];
    let service = fixture.createService({
      onUpdate: (update) => updates.push(update),
    });
    const savedState = fixture.db.giftDb.prepare(
      'SELECT * FROM overtime_machine_state',
    );
    try {
      service.setTime({ initialSeconds: 120, remainingSeconds: 60 });
      if (scenario.status !== 'disabled') service.act('enable');
      if (scenario.status === 'running') service.act('start');
      fixture.clock.advance(5_000);
      updates.length = 0;
      const before = service.getSnapshot();
      const savedBefore = savedState.get();
      fixture.db.giftDb.exec(`
        CREATE TEMP TRIGGER fail_overtime_save BEFORE UPDATE ON overtime_machine_state
        BEGIN SELECT RAISE(ABORT, 'simulated state save failure'); END;
      `);

      assert.throws(
        () => scenario.run(service),
        /simulated state save failure/,
      );
      assert.deepEqual(service.getSnapshot(), before);
      assert.equal(
        service.getCurrentEpoch(),
        before.enabled ? before.enableEpoch : 0,
      );
      assert.deepEqual(savedState.get(), savedBefore);
      assert.deepEqual(updates, []);
      fixture.clock.advance(1_000);
      assert.equal(
        service.getSnapshot().effectiveRemainingMs,
        before.effectiveRemainingMs -
          (scenario.status === 'running' ? 1_000 : 0),
      );

      fixture.db.giftDb.exec('DROP TRIGGER fail_overtime_save');
      const after = scenario.run(service);
      for (const [key, value] of Object.entries(scenario.expected)) {
        assert.deepEqual(after[key], value, key);
      }
      assert.equal(after.enableEpoch, 1);
      assert.equal(after.revision, before.revision + 1);
      assert.deepEqual(updates, [
        { reason: scenario.reason || 'manual', state: after },
      ]);
      assert.equal(savedState.get().revision, after.revision);
      service.dispose();
      service = fixture.createService();
      assert.deepEqual(service.getSnapshot(), after);
    } finally {
      service.dispose();
      fixture.close();
    }
  });
}

test('pause save failure keeps the original countdown and zero timer', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (update) => updates.push(update),
  });
  try {
    service.setTime({ remainingSeconds: 10 });
    service.act('enable');
    service.act('start');
    fixture.clock.advance(3_000);
    const revision = service.getSnapshot().revision;
    updates.length = 0;
    fixture.db.giftDb.exec(`
      CREATE TEMP TRIGGER fail_overtime_save BEFORE UPDATE ON overtime_machine_state
      BEGIN SELECT RAISE(ABORT, 'simulated state save failure'); END;
    `);
    assert.throws(() => service.act('pause'), /simulated state save failure/);
    fixture.db.giftDb.exec('DROP TRIGGER fail_overtime_save');

    fixture.clock.advance(6_999);
    assert.equal(service.getSnapshot().status, 'running');
    assert.equal(service.getSnapshot().effectiveRemainingMs, 1);
    assert.equal(service.getSnapshot().revision, revision);
    assert.deepEqual(updates, []);
    fixture.clock.advance(1);
    assert.equal(service.getSnapshot().status, 'finished');
    assert.equal(service.getSnapshot().revision, revision + 1);
    assert.equal(
      fixture.db.giftDb
        .prepare('SELECT remaining_ms FROM overtime_machine_state')
        .get().remaining_ms,
      0,
    );
    assert.deepEqual(
      updates.map((update) => update.reason),
      ['finished'],
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('disable transaction failure preserves pending gifts and their recovery timer', () => {
  const fixture = createFixture();
  const updates = [];
  const savedState = fixture.db.giftDb.prepare(
    'SELECT * FROM overtime_machine_state',
  );
  let attempts = 0;
  const service = fixture.createService({
    onUpdate: (update) => updates.push(update),
    randomInt() {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary settlement failure');
      return 0;
    },
  });
  try {
    service.setTime({ remainingSeconds: 10 });
    service.act('enable');
    service.act('start');
    service.replaceRules([
      {
        giftId: 'blind',
        giftName: 'Blind',
        mode: 'random',
        enabled: true,
        outcomes: [
          { seconds: 60, weight: 1 },
          { seconds: -30, weight: 1 },
        ],
      },
    ]);
    const event = fixture.insertFinalGift({
      giftId: 'blind',
      overtimeEpoch: 1,
    });
    assert.throws(
      () => service.finalizeGift(event),
      /temporary settlement failure/,
    );
    fixture.clock.advance(500);
    const before = service.getSnapshot();
    const savedBefore = savedState.get();
    const pendingBefore = fixture.getSettlement(event.giftEventId);
    updates.length = 0;
    fixture.db.giftDb.exec(`
      CREATE TEMP TRIGGER fail_overtime_disable BEFORE UPDATE OF status ON overtime_settlements
      WHEN NEW.status = 'ignored' AND OLD.status = 'pending'
      BEGIN SELECT RAISE(ABORT, 'simulated disable transaction failure'); END;
    `);

    assert.throws(
      () => service.act('disable'),
      /simulated disable transaction failure/,
    );
    assert.deepEqual(service.getSnapshot(), before);
    assert.deepEqual(savedState.get(), savedBefore);
    assert.deepEqual(fixture.getSettlement(event.giftEventId), pendingBefore);
    assert.equal(service.getCurrentEpoch(), 1);
    assert.deepEqual(updates, []);
    fixture.db.giftDb.exec('DROP TRIGGER fail_overtime_disable');

    fixture.clock.advance(500);
    assert.equal(attempts, 2);
    assert.equal(fixture.getSettlement(event.giftEventId).status, 'applied');
    assert.equal(service.getSnapshot().effectiveRemainingMs, 69_000);
    assert.deepEqual(
      updates.map((update) => update.reason),
      ['gift'],
    );
    const progress = fixture.insertProgressGift({
      giftId: 'blind',
      overtimeEpoch: 1,
    });
    service.observeGift(progress);
    const after = service.act('disable');
    assert.equal(after.status, 'disabled');
    assert.equal(after.revision, before.revision + 2);
    assert.equal(service.getCurrentEpoch(), 0);
    assert.equal(savedState.get().enabled, 0);
    assert.equal(fixture.getSettlement(progress.giftEventId).status, 'ignored');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('update notification failure does not roll back a successfully saved state', () => {
  const fixture = createFixture();
  let notifications = 0;
  const service = fixture.createService({
    onUpdate() {
      notifications += 1;
      throw new Error('notification failure');
    },
  });
  try {
    assert.throws(() => service.act('enable'), /notification failure/);
    assert.equal(service.getCurrentEpoch(), 1);
    const snapshot = service.act('enable');
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.revision, 1);
    const saved = fixture.db.giftDb
      .prepare('SELECT * FROM overtime_machine_state')
      .get();
    assert.equal(saved.enabled, 1);
    assert.equal(saved.enable_epoch, 1);
    assert.equal(saved.revision, 1);
    assert.equal(notifications, 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});
