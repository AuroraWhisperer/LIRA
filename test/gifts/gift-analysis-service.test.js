'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createGiftService, getBlindBoxAnalysis, getBlindBoxStats } = require('../../src/bilibili/gift');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createGiftSource, makeProcessedGiftEvent } = require('../helpers/processed-gift-fixture');

const LOCAL_NOON = new Date(2026, 8, 15, 12).getTime();

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: LOCAL_NOON });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-analysis-'));
  const db = createDatabases({ dataDir });
  const sourceId = createGiftSource(db.giftDb);
  const context = {
    db,
    settings: () => ({ enableGiftSprint: 'true' }),
    getActiveGiftSource: () => ({ sourceId }),
  };
  const service = createGiftService(context);
  service.setActiveSource({ sourceId });
  t.after(() => {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    db,
    context,
    importGift(eventId, gift) {
      return service.importProcessedEvent(
        makeProcessedGiftEvent(
          {
            isBlindBox: true,
            blindBoxName: '心动盲盒',
            ...gift,
          },
          { eventId },
        ),
        sourceId,
      );
    },
  };
}

test('blind box statistics count gift quantity and include record ids', (t) => {
  const f = fixture(t);
  const inserted = f.importGift('five', {
    giftName: 'Box Output',
    num: 5,
    unitPrice: 10,
    totalPrice: 50,
    blindBoxPrice: 25,
    blindProfit: 25,
  });
  const stats = getBlindBoxStats(f.context);
  assert.equal(stats.summary.boxCount, 5);
  assert.equal(stats.perUser[0].boxCount, 5);
  assert.equal(stats.records[0].id, inserted.id);
  assert.equal(stats.records[0].num, 5);
});

test('blind box statistics can filter one blind box type without changing the default total', (t) => {
  const f = fixture(t);
  f.importGift('heart', {
    giftName: 'Heart Output',
    num: 2,
    unitPrice: 10,
    totalPrice: 20,
    blindBoxPrice: 15,
    blindProfit: 5,
  });
  f.importGift('lucky', {
    giftName: 'Lucky Output',
    userName: 'Bob',
    num: 3,
    unitPrice: 10,
    totalPrice: 30,
    blindBoxName: '幸运盲盒',
    blindBoxPrice: 8,
    blindProfit: 22,
  });
  const allStats = getBlindBoxStats(f.context);
  const heartStats = getBlindBoxStats(f.context, { boxName: '心动盲盒' });
  assert.equal(allStats.summary.boxCount, 5);
  assert.equal(allStats.perUser.length, 2);
  assert.equal(heartStats.summary.boxCount, 2);
  assert.equal(heartStats.perUser.length, 1);
  assert.equal(heartStats.perUser[0].userName, 'Alice');
  assert.equal(heartStats.records.length, 1);
  assert.equal(heartStats.records[0].blind_box_name, '心动盲盒');
});

test('heart box progress resets after each romantic castle in event time order and survives replay', (t) => {
  const f = fixture(t);
  const open = (id, ms, extra = {}) => f.importGift(id, {
    blindBoxId: '32251', unitPrice: 10, totalPrice: 10, blindBoxPrice: 15, blindProfit: -5,
    createdAt: new Date(LOCAL_NOON + ms).toISOString(), ...extra,
  });
  const progress = () => getBlindBoxStats(f.context, { boxName: '心动盲盒' }).heartBoxProgress.openedSinceCastle;
  assert.equal(progress(), 0);
  open('before', 0, { num: 8 });
  assert.equal(progress(), 8);
  open('castle-1', 100, { giftId: '32132', giftName: '浪漫城堡' });
  assert.equal(progress(), 0);
  open('after', 200, { num: 4 });
  open('late-before-castle', 50, { num: 10 });
  assert.equal(progress(), 4, 'late import before the castle must not change its following count');
  open('after', 200, { num: 4 });
  assert.equal(progress(), 4, 'replaying an event does not double count');
  open('castle-2', 300, { giftId: '32132', giftName: '浪漫城堡', num: 2 });
  assert.equal(progress(), 0);
  open('after-second', 400, { num: 3 });
  assert.equal(progress(), 3);
});

test('heart box progress includes unknown profit but excludes other boxes, direct castles, dates and sources', (t) => {
  const f = fixture(t);
  const open = (id, extra = {}) => f.importGift(id, {
    blindBoxId: '32251', unitPrice: 5, totalPrice: 10, blindBoxPrice: 15, blindProfit: -5, num: 2, ...extra,
  });
  open('today');
  open('unknown', { num: 3, blindProfit: null, blindBoxPrice: null });
  open('yesterday', { num: 50, createdAt: new Date(LOCAL_NOON - 86400000).toISOString() });
  open('tomorrow', { num: 50, createdAt: new Date(LOCAL_NOON + 86400000).toISOString() });
  open('other-box-castle', { giftId: '32132', blindBoxId: '32252', blindBoxName: '幸运盲盒' });
  open('same-name-other-id', { giftId: '32132', blindBoxId: '32252' });
  open('direct-castle', { giftId: '32132', isBlindBox: false, blindBoxId: null, blindBoxName: '', blindBoxPrice: null, blindProfit: null });
  const foreign = open('foreign-castle', { giftId: '32132' });
  const sourceId = createGiftSource(f.db.giftDb, 'f'.repeat(64));
  f.db.giftDb.prepare('UPDATE gift_events SET source_id = ? WHERE id = ?').run(sourceId, foreign.id);
  const stats = getBlindBoxStats(f.context, { boxName: '心动盲盒' });
  assert.equal(stats.heartBoxProgress.openedSinceCastle, 5);
  assert.equal(stats.records.some(row => row.id === foreign.id), false);
  assert.equal(stats.records.some(row => row.profit === null), false);
  assert.equal(getBlindBoxStats(f.context).heartBoxProgress, null);
});

test('blind box analysis shares filters across viewer, box, and record views', (t) => {
  const f = fixture(t);
  f.importGift('analysis-1', {
    giftName: 'Heart A',
    num: 2,
    unitPrice: 10,
    totalPrice: 20,
    blindBoxPrice: 10,
    blindProfit: 10,
  });
  f.importGift('analysis-2', {
    giftName: 'Lucky A',
    unitPrice: 4,
    totalPrice: 4,
    blindBoxName: '幸运盲盒',
    blindBoxPrice: 8,
    blindProfit: -4,
  });
  f.importGift('analysis-3', {
    giftName: 'Heart B',
    userName: 'Bob',
    num: 3,
    unitPrice: 10,
    totalPrice: 30,
    blindBoxPrice: 18,
    blindProfit: 12,
  });
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 1, 0);
  f.importGift('future', {
    giftName: 'Future Output',
    userName: 'Future Viewer',
    num: 10,
    unitPrice: 10,
    totalPrice: 100,
    blindBoxName: '未来盲盒',
    blindBoxPrice: 50,
    blindProfit: 50,
    createdAt: tomorrow.toISOString(),
  });

  const users = getBlindBoxAnalysis(f.context, { view: 'users' });
  assert.equal(users.summary.boxCount, 6);
  assert.equal(users.summary.totalCost, 36);
  assert.equal(users.summary.totalValue, 54);
  assert.equal(users.summary.totalProfit, 18);
  assert.equal(users.items.length, 2);
  assert.deepEqual(
    users.items.map((item) => item.userName),
    ['Bob', 'Alice'],
  );
  assert.deepEqual(
    users.filters.viewers.map((item) => item.label),
    ['Alice', 'Bob'],
  );
  assert.deepEqual(users.filters.boxes, ['心动盲盒', '幸运盲盒']);

  const aliceKey = users.filters.viewers.find((item) => item.label === 'Alice').value;
  const aliceBoxes = getBlindBoxAnalysis(f.context, {
    viewer: aliceKey,
    view: 'boxes',
    sort: 'boxCount',
    direction: 'desc',
  });
  assert.equal(aliceBoxes.summary.boxCount, 3);
  assert.equal(aliceBoxes.summary.totalProfit, 6);
  assert.deepEqual(
    aliceBoxes.items.map((item) => item.boxName),
    ['心动盲盒', '幸运盲盒'],
  );
  const records = getBlindBoxAnalysis(f.context, {
    viewer: aliceKey,
    box: '心动盲盒',
    view: 'records',
    page: 1,
    limit: 1,
  });
  assert.equal(records.summary.boxCount, 2);
  assert.equal(records.pagination.total, 1);
  assert.equal(records.pagination.totalPages, 1);
  assert.equal(records.items[0].giftName, 'Heart A');
  assert.equal(records.items[0].num, 2);
});

test('blind box analysis bounds pagination and ignores unsupported sort fields', (t) => {
  const f = fixture(t);
  for (let index = 0; index < 3; index += 1) {
    f.importGift(`page-${index}`, {
      giftName: `Gift ${index}`,
      unitPrice: index + 1,
      totalPrice: index + 1,
      blindBoxPrice: 1,
      blindProfit: index,
    });
  }
  const result = getBlindBoxAnalysis(f.context, {
    view: 'records',
    page: 2,
    limit: 2,
    sort: 'DROP TABLE gift_events',
    direction: 'sideways',
  });
  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.limit, 2);
  assert.equal(result.pagination.total, 3);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.items.length, 1);
  assert.equal(f.db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 3);
});
