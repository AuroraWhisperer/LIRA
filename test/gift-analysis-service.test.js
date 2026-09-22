'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createGiftService, getBlindBoxAnalysis, getBlindBoxStats } = require('../src/bilibili/gift');
const { closeDatabases, createDatabases, getSchemaVersions } = require('../src/storage/database');
const { createGiftSource, makeProcessedGiftEvent } = require('./helpers/processed-gifts');

function fixture(t) {
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

test('gift database v3 identity migration remains intact after later migrations', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-v3-'));
  let db = createDatabases({ dataDir });

  try {
    db.giftDb.exec('DROP INDEX idx_gift_events_platform_uid');
    db.giftDb.prepare("UPDATE schema_version SET version = 2 WHERE key = 'gift_db'").run();
    const insert = db.giftDb.prepare(`
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, counted_in_sprint,
        status, created_at, updated_at
      ) VALUES (?, 'SEND_GIFT', '1', 'Rose', ?, ?, ?, ?, ?, 1, 'active', ?, ?)
    `);
    const createdAt = new Date().toISOString();
    insert.run('duplicate-platform', '42', 'Alice', 1, 1, 1, createdAt, createdAt);
    insert.run('duplicate-platform', '42', 'Alice Renamed', 5, 1, 5, createdAt, createdAt);
    insert.run('duplicate-platform', '43', 'Bob', 1, 1, 1, createdAt, createdAt);
    closeDatabases(db);

    db = createDatabases({ dataDir });
    assert.equal(getSchemaVersions(db).giftDb, 14);
    const rows = db.giftDb
      .prepare(
        `
      SELECT * FROM gift_events WHERE platform_id = ? ORDER BY uid
    `,
      )
      .all('duplicate-platform');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].uid, '42');
    assert.equal(rows[0].user_name, 'Alice Renamed');
    assert.equal(rows[0].num, 5);
    assert.equal(rows[0].total_price, 5);
    assert.equal(rows[1].uid, '43');
    assert.throws(() => insertDuplicateGift(db.giftDb, createdAt), /UNIQUE constraint failed/);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function insertDuplicateGift(giftDb, createdAt) {
  giftDb
    .prepare(
      `
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name, uid, user_name,
      num, unit_price, total_price, status, created_at, updated_at
    ) VALUES ('duplicate-platform', 'SEND_GIFT', '1', 'Rose', '42', 'Alice',
      1, 1, 1, 'active', ?, ?)
  `,
    )
    .run(createdAt, createdAt);
}
