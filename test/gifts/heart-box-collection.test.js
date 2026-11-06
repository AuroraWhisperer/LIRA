'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('../helpers/gift-query-fixture');
const { createGiftWishStore } = require('../../src/storage/gift-wish-store');
const { createHeartBoxCollectionService } = require('../../src/bilibili/gift/heart-box-collection');

function setup(t, date = '2026-11-05T15:00:00.000Z') {
  const scratchDir = path.join(__dirname, '../../tmp');
  fs.mkdirSync(scratchDir, { recursive: true });
  const fixture = createFixture({ scratchDir });
  t.after(() => fixture.close());
  const source = fixture.resolveSource('a'.repeat(64)).id;
  const other = fixture.resolveSource('b'.repeat(64)).id;
  fixture.setActiveSource(source, { partial: false });
  let time = Date.parse(date);
  const service = createHeartBoxCollectionService({
    store: createGiftWishStore(fixture.giftDb),
    gifts: {
      getActiveSource: fixture.context.getActiveGiftSource,
      getViewRevision: () => `source-${fixture.context.getActiveGiftSource()?.sourceId}`,
    },
    catalog: { getArtworkResolver: () => () => '' },
    now: () => time,
  });
  let sequence = 0;
  function box(createdAt, num, { sourceId = source, boxId = '32251', ...overrides } = {}) {
    const row = fixture.insertGift(sourceId, `collection-${++sequence}`, {
      createdAt, num, isBlindBox: true, blindBoxName: '心动盲盒', giftId: '32128', ...overrides,
    });
    fixture.giftDb.prepare('UPDATE gift_events SET blind_box_id=? WHERE id=?').run(boxId, row.lastInsertRowid);
  }
  return { fixture, source, other, service, box, at: (value) => { time = Date.parse(value); } };
}

test('collection includes earlier current-week openings, castles and quantities, using only its active source', (t) => {
  const { service, box, other } = setup(t);
  box('2026-10-30T15:59:59.999Z', 100);
  box('2026-10-30T16:00:00.000Z', 20);
  box('2026-11-02T10:00:00.000Z', 1, { giftId: '32132' });
  box('2026-11-05T14:00:00.000Z', 16);
  box('2026-11-03T10:00:00.000Z', 100, { sourceId: other });
  box('2026-11-03T10:00:00.000Z', 100, { isBlindBox: false });
  box('2026-11-03T10:00:00.000Z', 100, { boxId: '999' });
  box('2026-11-03T10:00:00.000Z', 100, { detectionStatus: 'pending' });
  box('2026-11-03T10:00:00.000Z', 100, { status: 'retracted' });
  const value = service.getSnapshot();
  assert.equal(value.count, 37);
  assert.equal(value.target, 40);
  assert.equal(value.remaining, 3);
  assert.equal(value.stages[0].unlocked, true);
  assert.equal(value.stages[1].unlocked, false);
});

test('Shanghai Friday closes collection and Saturday starts a new period without changing prior records', (t) => {
  const { service, box, at } = setup(t, '2026-11-05T15:59:59.999Z');
  box('2026-11-05T15:59:59.999Z', 40);
  box('2026-11-05T16:00:00.000Z', 100);
  box('2026-11-06T15:59:59.999Z', 100);
  box('2026-11-06T16:00:00.000Z', 5);
  assert.equal(service.getSnapshot().status, 'collecting');
  at('2026-11-05T16:00:00.000Z');
  const closed = service.getSnapshot();
  assert.equal(closed.status, 'ended');
  assert.equal(closed.count, 40);
  assert.equal(closed.startsAt, '2026-10-30T16:00:00.000Z');
  assert.equal(closed.endsAt, '2026-11-05T16:00:00.000Z');
  at('2026-11-06T15:59:59.999Z');
  assert.equal(service.getSnapshot().count, 40);
  at('2026-11-06T16:00:00.000Z');
  const next = service.getSnapshot();
  assert.equal(next.status, 'collecting');
  assert.equal(next.count, 5);
  assert.equal(next.startsAt, closed.nextStartsAt);
});

test('fixed rewards unlock at each threshold and preserve counts beyond the last stage', (t) => {
  const { service, box } = setup(t);
  for (const [num, target, unlocked] of [[20, 40, 1], [20, 80, 2], [40, 120, 3], [47, 120, 4]]) {
    box('2026-11-03T12:00:00.000Z', num);
    const value = service.getSnapshot();
    assert.equal(value.target, target);
    assert.equal(value.stages.filter((stage) => stage.unlocked).length, unlocked);
  }
  const value = service.getSnapshot();
  assert.equal(value.count, 127);
  assert.equal(value.completed, true);
  assert.equal(value.remaining, 0);
  assert.equal(value.stages[1].multiplier, 4);
  assert.equal(value.stages[1].castles, 2);
  assert.equal(value.stages[3].multiplier, 5);
  assert.equal(value.stages[3].castles, 2);
});

test('legacy exact box names count only when their box ID is missing', (t) => {
  const { service, box } = setup(t);
  box('2026-11-03T12:00:00.000Z', 3, { boxId: null });
  box('2026-11-03T12:00:00.000Z', 10, { boxId: null, blindBoxName: '其他盲盒' });
  box('2026-11-03T12:00:00.000Z', 10, { boxId: '999' });
  assert.equal(service.getSnapshot().count, 3);
});

test('source changes recompute progress and unavailable sources cannot expose the previous count', (t) => {
  const { fixture, source, other, service, box } = setup(t);
  box('2026-11-03T12:00:00.000Z', 37);
  box('2026-11-03T12:00:00.000Z', 5, { sourceId: other });
  assert.equal(service.getSnapshot().count, 37);
  fixture.setActiveSource(other);
  assert.equal(service.getSnapshot().count, 5);
  assert.equal(service.getSnapshot().partial, true);
  fixture.setActiveSource(source, { syncState: 'SOURCE_SWITCHING' });
  assert.throws(() => service.getSnapshot(), { code: 'GIFT_SOURCE_UNAVAILABLE' });
  fixture.clearActiveSource();
  assert.throws(() => service.getSnapshot(), { code: 'GIFT_SOURCE_UNAVAILABLE' });
});
