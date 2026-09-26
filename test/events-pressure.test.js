'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const vm = require('node:vm');
const { createGiftProjectionService } = require('../src/bilibili/gift');
const { normalizeProcessedGiftEvent } = require('../src/shared/processed-gift-contract');
const { createFixture } = require('./helpers/overtime-service-fixture');
const { createGiftSource, makeProcessedGiftEvent } = require('./helpers/processed-gifts');
const { fanFixture, SCOPE, NOW } = require('./helpers/fan-profile-fixture');

test('1000 fan facts preserve full history across replay, a failed page and restart', (t) => {
  const f = fanFixture(t);
  const events = Array.from({ length: 1000 }, (_, index) => ({
    id: `pressure-membership-${index}`,
    identity: { platform: 'bilibili', type: 'uid', value: String(900000001 + index % 100) },
    name: 'Same display name',
    kind: 'membership',
    membership: { type: 'observation', level: 3, observedAt: NOW },
  }));
  const started = performance.now();
  for (let index = 0; index < events.length; index += 200) f.consume(events.slice(index, index + 200));
  const profiles = f.store.list(SCOPE);
  assert.equal(profiles.length, 100);
  assert.equal(f.run('settings').cursor, 1000);
  for (const profile of profiles) assert.equal(f.detail(profile.id).records.length, 10);

  for (let index = 0; index < events.length; index += 200) {
    const replay = events.slice(index, index + 200).map((event, offset) => ({ ...event, cursor: index + offset + 1 }));
    f.consume(replay, index === 0 ? { reset: true, after: 0, nextCursor: 200 } : {});
  }
  const revisions = profiles.map((profile) => f.detail(profile.id).revision);
  const latePage = Array.from({ length: 200 }, (_, index) => ({
    ...events[index], id: `later-${index}`, name: 'This page must roll back',
    observedAt: '2026-09-19T04:00:00.000Z',
  }));
  latePage[199].membership = { type: 'interval', level: 3, start: '2026-09-01', end: '2026-09-30' };
  assert.throws(() => f.consume(latePage), /已核实证据/);
  assert.equal(f.run('settings').cursor, 1000);
  assert.deepEqual(profiles.map((profile) => f.detail(profile.id).revision), revisions);
  f.restart();
  for (const profile of profiles) {
    const actual = f.detail(profile.id);
    assert.equal(actual.records.length, 10, 'replays and an aborted page add no history');
    assert.equal(actual.platformName, 'Same display name');
    assert.equal(new Set(actual.records.map((record) => record.sourceKey)).size, 10);
  }
  assert.equal(f.run('settings').cursor, 1000);
  t.diagnostic(JSON.stringify({ scenario: 'fan-facts', facts: 1000, replays: 1000, users: 100,
    rejectedPage: 200, retainedRecords: 1000, elapsedMs: Number((performance.now() - started).toFixed(2)) }));
});

test('100000 processed gift items preserve independent draws, exact indexes and replay idempotence', (t) => {
  const fixture = createFixture();
  let draws = 0;
  let sampledPeak = 0;
  const service = fixture.createService({
    randomInt(totalWeight) {
      assert.equal(totalWeight, 2);
      if (draws % 1000 === 0) sampledPeak = Math.max(sampledPeak, process.memoryUsage().heapUsed);
      return draws++ % 2;
    },
  });
  const projection = createGiftProjectionService({ db: fixture.db, settings: () => ({}) }, {
    getOvertimeEpoch: service.getCurrentEpoch,
    onGiftFinalized: (row) => service.finalizeGift({ giftEventId: row.id }),
  });
  t.after(() => { projection.dispose(); service.dispose(); fixture.close(); });
  service.act('enable');
  service.setTime({ remainingSeconds: 60 });
  service.replaceRules([{
    giftId: 'guard-3',
    giftName: '舰长',
    mode: 'random',
    quantityMode: 'item',
    outcomes: [{ operation: 'add', value: 2, weight: 1 }, { operation: 'subtract', value: 1, weight: 1 }],
    enabled: true,
  }]);
  const source = createGiftSource(fixture.db.giftDb);
  const event = makeProcessedGiftEvent({ giftId: '10003', giftName: '舰长', num: 100000, totalPrice: 10000 });
  normalizeProcessedGiftEvent(event);
  const maximum = makeProcessedGiftEvent({ num: Number.MAX_SAFE_INTEGER, unitPrice: 0.01, totalPrice: 0.01 });
  const acceptedMaximum = normalizeProcessedGiftEvent(maximum).gift.num;
  global.gc?.();
  const beforeHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  const row = projection.importProcessedEvent(event, source);
  const elapsedMs = performance.now() - started;
  assert.equal(draws, 100000);
  assert.equal(service.getSnapshot().effectiveRemainingMs, 50_060_000);
  const settlement = fixture.getSettlement(row.id);
  const outcome = JSON.parse(settlement.outcomes_json);
  assert.equal(outcome.version, 3);
  assert.equal(outcome.quantity, 100000);
  assert.equal(outcome.selectedIndexes.length, 100000);
  assert.ok(outcome.selectedIndexes.every((value, index) => value === index % 2));
  projection.importProcessedEvent(event, source);
  assert.equal(draws, 100000);
  assert.equal(fixture.countSettlements(row.id), 1);
  t.diagnostic(JSON.stringify({
    scenario: 'overtime-random-items',
    quantity: draws,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    sampledHeapIncreaseBytes: Math.max(0, sampledPeak - beforeHeap),
    persistedOutcomesBytes: Buffer.byteLength(settlement.outcomes_json),
    acceptedMaximum,
    maximumInputBytes: Buffer.byteLength(JSON.stringify(maximum)),
  }));
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
    clearTimeout(timer) { timers.delete(timer); fixture.clock.clearTimeout(timer); },
  });
  const projection = createGiftProjectionService({ db: fixture.db, settings: () => ({}) }, {
    getOvertimeEpoch: service.getCurrentEpoch,
    onGiftFinalized: (row) => service.finalizeGift({ giftEventId: row.id }),
  });
  t.after(() => { projection.dispose(); service.dispose(); fixture.close(); });
  service.act('enable');
  service.setTime({ remainingSeconds: 10 });
  service.act('start');
  service.replaceRules([{ giftId: 'guard-3', giftName: '舰长', mode: 'fixed', fixedSeconds: 1, enabled: true }]);
  const source = createGiftSource(fixture.db.giftDb);
  const started = performance.now();
  for (let index = 0; index < 1000; index++) {
    const event = makeProcessedGiftEvent({ giftId: '10003', giftName: '舰长' }, {
      eventId: `pressure-${index}`, cursor: index + 1,
    });
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
  t.diagnostic(JSON.stringify({ scenario: 'gift-burst', events: 1000, deliveries: 2000, peakTimers,
    elapsedMs: Number((performance.now() - started).toFixed(2)) }));
});

for (const scenario of [
  { reliableIds: false, users: 64 },
  { reliableIds: true, users: 64 },
  { reliableIds: false, users: 50000 },
]) {
  test(`rating pressure retains exact state: IDs=${scenario.reliableIds}, users=${scenario.users}`, (t) => {
    const maps = [];
    const sets = [];
    class CountedMap extends Map {
      constructor(...args) { super(...args); maps.push(this); }
    }
    class CountedSet extends Set {
      constructor(...args) { super(...args); sets.push(this); }
    }
    const filename = path.join(__dirname, '../src/games/interaction-session-service.js');
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module,
      require: createRequire(filename),
      Map: CountedMap,
      Set: CountedSet,
    }, { filename });
    const source = { ready: true, accountUid: '80000', roomId: '100', ownerUid: '90000', connectionKey: '1' };
    let listener = null;
    let tasks = 0;
    const service = module.exports.createInteractionSessionService({
      now: () => 1000,
      wallNow: () => 1_800_000_000_000,
      getSourceState: () => source,
      subscribe(callback) { listener = callback; return () => { listener = null; }; },
      setTimeout() { tasks++; return {}; },
      clearTimeout() {},
    });
    t.after(() => service.dispose());
    const id = service.start({ kind: 'rating' }).session.sessionId;
    const expected = new Map();
    const started = performance.now();
    for (let index = 0; index < 50000; index++) {
      const uid = String(1 + index % scenario.users);
      const score = 1 + index % 10;
      listener({ ...source, source: 'danmaku', receivedAt: 1000, platformTime: 1,
        eventId: scenario.reliableIds ? `event-${index}` : null, uid, message: String(score) });
      expected.set(uid, score);
    }
    if (scenario.reliableIds) {
      listener({ ...source, source: 'danmaku', receivedAt: 1000, platformTime: 1,
        eventId: 'event-0', uid: '1', message: '10' });
    }
    assert.equal(service.getHostState().participants, scenario.users);
    assert.equal(tasks, 0);
    const retainedTimestamps = maps.reduce((sum, map) => sum + map.size, 0);
    const retainedEventIds = sets.reduce((sum, set) => sum + set.size, 0);
    assert.equal(retainedTimestamps, scenario.users);
    assert.equal(retainedEventIds, scenario.reliableIds ? 50000 : 0);
    const final = service.finish(id);
    assert.equal(final.session.average, [...expected.values()].reduce((sum, value) => sum + value, 0) / expected.size);
    assert.equal(listener, null);
    assert.equal(maps.reduce((sum, map) => sum + map.size, 0), 0);
    assert.equal(sets.reduce((sum, set) => sum + set.size, 0), 0);
    service.clear(id);
    assert.equal(service.getState().session, null);
    t.diagnostic(JSON.stringify({ scenario: 'rating', ...scenario, messages: 50000, retainedTimestamps,
      retainedEventIds, elapsedMs: Number((performance.now() - started).toFixed(2)) }));
  });
}
