'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFixture } = require('./helpers/gift-query-fixture');
const { createGiftWishStore } = require('../src/storage/gift-wish-store');
const { migrateGiftWishes, migrateGiftWishDisplay } = require('../src/storage/gift-wish-migration');
const { runAllMigrations } = require('../src/storage/database-migrations');
const { createGiftWishService } = require('../src/bilibili/gift/wish-service');
const { giftVariantId } = require('../src/shared/gift-identity');
const { mergeVariantRoomCatalog } = require('../src/bilibili/gift/variant-room-catalog');

function setup(t) {
  const fixture = createFixture();
  t.after(() => fixture.close());
  const source = fixture.resolveSource('a'.repeat(64)).id;
  const other = fixture.resolveSource('b'.repeat(64)).id;
  fixture.setActiveSource(source, { partial: false });
  let time = Date.parse('2026-09-20T04:00:00Z');
  let room = {
    live_status: 1,
    live_time: Date.parse('2026-09-20T02:00:00Z') / 1000,
  };
  let readCount = 0;
  const store = createGiftWishStore(fixture.giftDb);
  const options = {
    store,
    gifts: {
      getActiveSource: fixture.context.getActiveGiftSource,
      getViewRevision: () => `source-${fixture.context.getActiveGiftSource()?.sourceId}`,
    },
    catalog: {
      getSnapshot: () => ({
        gifts: [
          {
            id: '1',
            name: '小花花',
            variantId: 'flower-v1',
            giftCategory: 'directGift',
            imagePath: '/overtime-gift-images/flower.webp',
          },
          {
            id: '2',
            name: '心动盲盒',
            variantId: 'box-v1',
            giftCategory: 'blindBox',
          },
          {
            id: '3',
            name: '花束',
            variantId: 'output-v1',
            giftCategory: 'blindBoxOutput',
          },
        ],
      }),
    },
    getRoomId: () => '123',
    now: () => time,
    readRoom: async () => {
      readCount++;
      if (room instanceof Error) throw room;
      return room;
    },
  };
  const service = createGiftWishService(options);
  function add(period, giftKey = 'flower-v1', overrides = {}) {
    return service.save({
      viewRevision: `source-${source}`,
      period,
      giftKey,
      target: 10,
      label: '',
      ...overrides,
    }).id;
  }
  function event(id, date, quantity, overrides = {}) {
    const { variant = 'flower-v1', boxVariant = null, boxId = null, ...rest } = overrides;
    const result = fixture.insertGift(source, id, {
      giftId: '1',
      giftName: '小花花',
      createdAt: new Date(date).toISOString(),
      num: quantity,
      ...rest,
    });
    fixture.giftDb
      .prepare('UPDATE gift_events SET gift_variant_id = ?, blind_box_variant_id = ?, blind_box_id = ? WHERE id = ?')
      .run(variant, boxVariant, boxId, result.lastInsertRowid);
  }
  return {
    fixture,
    source,
    other,
    store,
    service,
    options,
    add,
    event,
    reads: () => readCount,
    time: (value) => {
      time = Date.parse(value);
    },
    room: (value) => {
      room = value;
    },
  };
}

test('three periods count final integer quantities in their own windows and survive restart', async (t) => {
  const f = setup(t);
  migrateGiftWishes(f.fixture.giftDb);
  migrateGiftWishes(f.fixture.giftDb);
  f.add('long');
  f.add('day');
  f.add('session');
  f.event('yesterday', '2026-09-19T15:59:59Z', 50);
  f.event('midnight', '2026-09-19T16:00:00Z', 2, { giftStatsEligible: 0 });
  f.event('stream', '2026-09-20T02:10:00Z', 3);
  f.event('after', '2026-09-20T04:01:00Z', 4);
  f.event('pending', '2026-09-20T04:01:00Z', 50, {
    detectionStatus: 'progress',
  });
  f.event('fraction', '2026-09-20T04:01:00Z', 1.5);
  f.event('different-variant', '2026-09-20T04:01:00Z', 99, {
    variant: 'flower-v2',
  });
  f.fixture.insertGift(f.other, 'private-other', {
    giftId: '1',
    createdAt: '2026-09-20T04:01:00Z',
    num: 99,
  });
  f.time('2026-09-20T04:02:00Z');
  const snapshot = await f.service.getSnapshot();
  assert.deepEqual(Object.fromEntries(snapshot.items.map((item) => [item.period, item.count])), {
    long: 4,
    day: 9,
    session: 7,
  });
  const restarted = await createGiftWishService(f.options).getSnapshot();
  assert.deepEqual(restarted.items, snapshot.items);
  assert.deepEqual((await f.service.getSnapshot()).items, snapshot.items, 'reads do not accumulate twice');
  const row = snapshot.items.find((item) => item.period === 'long');
  f.service.save({
    viewRevision: snapshot.viewRevision,
    id: row.id,
    target: 3,
    label: '小目标',
  });
  const edited = (await f.service.getSnapshot()).items.find((item) => item.id === row.id);
  assert.equal(edited.startAt, row.startAt);
  assert.equal(edited.count, 4);
  assert.equal(edited.progress, 100);
  assert.equal(edited.completed, true);
});

test('blind box body and output use separate confirmed identities, guards use bundled art', async (t) => {
  const f = setup(t);
  f.add('day', 'box-v1');
  f.add('day', 'output-v1');
  f.add('day', 'guard-3');
  f.event('box', '2026-09-20T03:00:00Z', 6, {
    giftId: '3',
    variant: 'output-v1',
    isBlindBox: true,
    boxVariant: 'box-v1',
    boxId: '2',
  });
  f.event('unknown-box', '2026-09-20T03:00:00Z', 1, {
    giftId: '3',
    variant: 'output-v1',
    isBlindBox: true,
  });
  f.event('direct-output', '2026-09-20T03:00:00Z', 8, {
    giftId: '3',
    variant: 'output-v1',
  });
  f.event('guard', '2026-09-20T03:00:00Z', 2, {
    giftId: '10003',
    variant: null,
  });
  const items = (await f.service.getSnapshot()).items;
  assert.equal(items.find((item) => item.giftId === '2').count, 6);
  assert.equal(items.find((item) => item.giftId === '3').count, 7);
  const guard = items.find((item) => item.giftId === 'guard-3');
  assert.equal(guard.count, 2);
  assert.match(guard.imagePath, /bilibili-guard-captain.webp$/);
});

test('Beijing midnight and a new broadcast reset only their matching periods', async (t) => {
  const f = setup(t);
  f.add('long');
  f.add('day');
  f.add('session');
  f.event('after', '2026-09-20T04:01:00Z', 4);
  f.time('2026-09-20T15:59:59Z');
  await f.service.getSnapshot();
  f.time('2026-09-20T16:00:00Z');
  const midnight = await f.service.getSnapshot();
  assert.equal(midnight.items.find((item) => item.period === 'day').count, 0);
  assert.equal(midnight.items.find((item) => item.period === 'session').count, 4);
  f.time('2026-09-20T17:00:00Z');
  f.room({ live_status: 0 });
  f.event('offline-before-reopen', '2026-09-20T16:30:00Z', 2);
  const offline = await f.service.getSnapshot();
  assert.equal(offline.session.state, 'offline');
  assert.equal(offline.items.find((item) => item.period === 'session').count, 0);
  assert.equal(offline.session.endedAt, '2026-09-20T15:59:59.000Z');
  f.event('offline-gift', '2026-09-20T17:01:00Z', 3);
  f.time('2026-09-20T17:02:00Z');
  assert.equal((await f.service.getSnapshot()).items.find((item) => item.period === 'session').count, 0);
  f.room(new Error('network unavailable after offline'));
  f.time('2026-09-20T17:03:00Z');
  assert.equal(
    (await createGiftWishService(f.options).getSnapshot()).items.find((item) => item.period === 'session').count,
    0,
  );
  f.room({
    live_status: 1,
    live_time: Date.parse('2026-09-20T18:00:00Z') / 1000,
  });
  f.time('2026-09-20T18:01:00Z');
  assert.equal((await f.service.getSnapshot()).items.find((item) => item.period === 'session').count, 0);
  assert.equal((await f.service.getSnapshot()).items.find((item) => item.period === 'long').count, 9);
});

test('session failures preserve known boundaries and concurrent reads share one request', async (t) => {
  const f = setup(t);
  f.add('session');
  f.event('confirmed-live', '2026-09-20T03:59:00Z', 2);
  const [first, second] = await Promise.all([f.service.getSnapshot(), f.service.getSnapshot()]);
  assert.equal(f.reads(), 1);
  assert.deepEqual(first.session, second.session);
  f.room(new Error('offline network'));
  f.event('after-last-confirmed-live', '2026-09-20T04:00:30Z', 3);
  f.time('2026-09-20T04:01:00Z');
  const failed = await f.service.getSnapshot();
  assert.equal(failed.session.stale, true);
  assert.equal(failed.session.startedAt, first.session.startedAt);
  assert.equal(failed.session.endedAt, null);
  assert.equal(failed.items[0].count, 2);
  assert.equal((await createGiftWishService(f.options).getSnapshot()).items[0].count, 2);
  f.room({
    live_status: 1,
    live_time: Date.parse(first.session.startedAt) / 1000,
  });
  f.time('2026-09-20T04:02:00Z');
  assert.equal((await f.service.getSnapshot()).items[0].count, 5);
});

test('reject fractional targets, stale edits and cross-source access without changing saved wishes', async (t) => {
  const f = setup(t);
  const id = f.add('long');
  for (const target of [0, -1, 1.5, '2', NaN, Infinity, 1000000000]) {
    assert.throws(() => f.add('day', 'flower-v1', { target }), {
      code: 'INVALID_GIFT_WISH',
    });
  }
  assert.throws(() => f.add('day', 'unknown'), { code: 'INVALID_GIFT_WISH' });
  f.fixture.setActiveSource(f.other);
  assert.equal((await f.service.getSnapshot()).items.length, 0);
  assert.throws(() => f.service.remove({ id, viewRevision: `source-${f.source}` }), { code: 'GIFT_VIEW_STALE' });
  assert.throws(() => f.service.remove({ id, viewRevision: `source-${f.other}` }), { code: 'INVALID_GIFT_WISH' });
  assert.equal(f.store.list(f.source).length, 1);
  f.fixture.setActiveSource(f.source, { syncState: 'SOURCE_SWITCHING' });
  await assert.rejects(f.service.getSnapshot(), {
    code: 'GIFT_SOURCE_UNAVAILABLE',
  });
});

test('unresolved room gifts cannot create wishes that count another variant sharing their ID', async (t) => {
  const f = setup(t);
  const archived = {
    id: '1',
    name: '小花花',
    priceRaw: 1000,
    coinType: 'gold',
    bagGift: false,
    giftCategory: 'directGift',
  };
  archived.variantId = giftVariantId(archived);
  const catalog = { schemaVersion: 3, gifts: [archived] };
  const room = mergeVariantRoomCatalog({ gifts: [{ ...archived, priceRaw: 2000 }] }, catalog, []);
  f.options.catalog.getGlobalSnapshot = () => catalog;
  f.options.catalog.getSnapshot = () => room;
  f.event('old-price', '2026-09-20T03:00:00Z', 9, { variant: archived.variantId });

  assert.throws(() => f.add('day', '1'), { code: 'INVALID_GIFT_WISH' });
  assert.equal(f.store.list(f.source).length, 0);
  f.add('day', archived.variantId);
  assert.equal((await f.service.getSnapshot()).items[0].count, 9);
});

test('v13 wishes upgrade to card display without losing identity, progress or creation time', async (t) => {
  const f = setup(t);
  const id = f.add('long');
  f.event('received', '2026-09-20T04:01:00Z', 4);
  f.time('2026-09-20T04:02:00Z');
  const before = (await f.service.getSnapshot()).items[0];
  f.fixture.giftDb.exec(`
    ALTER TABLE gift_wishes DROP COLUMN display_style;
    ALTER TABLE gift_wishes DROP COLUMN text_template;
    UPDATE schema_version SET version = 13 WHERE key = 'gift_db';
  `);
  runAllMigrations(f.fixture.databases);
  migrateGiftWishDisplay(f.fixture.giftDb);
  runAllMigrations(f.fixture.databases);
  const service = createGiftWishService({ ...f.options, store: createGiftWishStore(f.fixture.giftDb) });
  const wish = (await service.getSnapshot()).items[0];
  assert.deepEqual(wish, { ...before, id, displayStyle: 'card', textTemplate: '' });
  assert.equal(wish.count, 4);
});

test('display choices persist across restart and edits preserve counts and omitted display fields', async (t) => {
  const f = setup(t);
  const textTemplate = '今天想要{礼物}：{已收}/{目标}';
  const id = f.add('long', 'flower-v1', { displayStyle: 'text', textTemplate });
  f.event('received', '2026-09-20T04:01:00Z', 4);
  f.time('2026-09-20T04:02:00Z');
  const service = createGiftWishService({ ...f.options, store: createGiftWishStore(f.fixture.giftDb) });
  const first = (await service.getSnapshot()).items[0];
  assert.equal(first.displayStyle, 'text');
  assert.equal(first.textTemplate, textTemplate);
  service.save({ id, viewRevision: `source-${f.source}`, target: 20, label: '仅备注' });
  const updated = (await service.getSnapshot()).items[0];
  assert.equal(updated.displayStyle, 'text');
  assert.equal(updated.textTemplate, textTemplate);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.count, 4);
  service.save({ id, viewRevision: `source-${f.source}`, target: 20, label: '', displayStyle: 'card' });
  assert.equal((await service.getSnapshot()).items[0].textTemplate, textTemplate);
  f.fixture.setActiveSource(f.other);
  assert.throws(
    () => service.save({ id, viewRevision: `source-${f.other}`, target: 20, label: '', displayStyle: 'text' }),
    {
      code: 'INVALID_GIFT_WISH',
    },
  );
  assert.equal(f.store.list(f.source)[0].display_style, 'card');
});

test('circle wishes persist and switching display styles preserves the gift and collected progress', async (t) => {
  const f = setup(t);
  const id = f.add('long', 'flower-v1', { displayStyle: 'circle', target: 20 });
  f.event('received', '2026-09-20T04:01:00Z', 3);
  f.time('2026-09-20T04:02:00Z');
  const service = createGiftWishService({ ...f.options, store: createGiftWishStore(f.fixture.giftDb) });
  const first = (await service.getSnapshot()).items[0];
  assert.equal(first.displayStyle, 'circle');
  assert.equal(first.imagePath, '/overtime-gift-images/flower.webp');
  assert.equal(first.count, 3);
  for (const displayStyle of ['card', 'text', 'circle']) {
    service.save({ id, viewRevision: `source-${f.source}`, target: 20, label: '', displayStyle });
    assert.deepEqual((await service.getSnapshot()).items[0], { ...first, displayStyle });
  }
});

test('display validation rejects unsupported styles and invalid text without changing existing wishes', async (t) => {
  const f = setup(t);
  const id = f.add('day');
  for (const values of [
    { displayStyle: 'unknown' },
    { displayStyle: null },
    { displayStyle: 1 },
    { textTemplate: null },
    { textTemplate: {} },
    { textTemplate: '字'.repeat(201) },
  ]) {
    assert.throws(() => f.add('long', 'flower-v1', values), { code: 'INVALID_GIFT_WISH' });
    assert.throws(() => f.service.save({ id, viewRevision: `source-${f.source}`, target: 10, label: '', ...values }), {
      code: 'INVALID_GIFT_WISH',
    });
  }
  assert.equal(f.store.list(f.source).length, 1);
  const wish = (await f.service.getSnapshot()).items[0];
  assert.equal(wish.displayStyle, 'card');
  assert.equal(wish.textTemplate, '');
  f.service.save({
    id,
    viewRevision: `source-${f.source}`,
    target: 10,
    label: '',
    displayStyle: 'text',
    textTemplate: '  ',
  });
  assert.equal((await f.service.getSnapshot()).items[0].textTemplate, '');
});
