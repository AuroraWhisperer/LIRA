'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const packetParser = require('../src/bilibili/packet-parser');
const {
  createGiftService,
  getBlindBoxAnalysis,
  getBlindBoxStats,
  repairGiftV2Events,
} = require('../src/bilibili/gift');
const {
  closeDatabases,
  createDatabases,
  getSchemaVersions,
} = require('../src/storage/database');

test('blind box statistics count gift quantity and include record ids', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-blind-count-'),
  );
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  };
  const service = createGiftService(context);

  try {
    const inserted = service.add({
      platformId: 'blind-box-five',
      cmd: 'BLIND_GIFT',
      giftId: 'box-output',
      giftName: 'Box Output',
      uid: '42',
      userName: 'Alice',
      num: 5,
      unitPrice: 10,
      totalPrice: 50,
      isBlindBox: true,
      blindBoxName: 'Lucky Box',
      blindBoxPrice: 25,
      messageTimestamp: Date.now(),
    });
    const stats = getBlindBoxStats(context);

    assert.equal(stats.summary.boxCount, 5);
    assert.equal(stats.perUser[0].boxCount, 5);
    assert.equal(stats.records[0].id, inserted.id);
    assert.equal(stats.records[0].num, 5);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('blind box statistics can filter one blind box type without changing the default total', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-blind-filter-'),
  );
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  };
  const service = createGiftService(context);

  try {
    service.add({
      platformId: 'heart-box-filter',
      cmd: 'BLIND_GIFT',
      giftId: 'heart-output',
      giftName: 'Heart Output',
      uid: '42',
      userName: 'Alice',
      num: 2,
      unitPrice: 10,
      totalPrice: 20,
      isBlindBox: true,
      blindBoxName: '心动盲盒',
      blindBoxPrice: 15,
      messageTimestamp: Date.now(),
    });
    service.add({
      platformId: 'lucky-box-filter',
      cmd: 'BLIND_GIFT',
      giftId: 'lucky-output',
      giftName: 'Lucky Output',
      uid: '43',
      userName: 'Bob',
      num: 3,
      unitPrice: 10,
      totalPrice: 30,
      isBlindBox: true,
      blindBoxName: '幸运盲盒',
      blindBoxPrice: 8,
      messageTimestamp: Date.now(),
    });

    const allStats = getBlindBoxStats(context);
    const heartStats = getBlindBoxStats(context, { boxName: '心动盲盒' });

    assert.equal(allStats.summary.boxCount, 5);
    assert.equal(allStats.perUser.length, 2);
    assert.equal(heartStats.summary.boxCount, 2);
    assert.equal(heartStats.perUser.length, 1);
    assert.equal(heartStats.perUser[0].userName, 'Alice');
    assert.equal(heartStats.records.length, 1);
    assert.equal(heartStats.records[0].blind_box_name, '心动盲盒');
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('blind box analysis shares filters across viewer, box, and record views', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-blind-analysis-'),
  );
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  };
  const service = createGiftService(context);

  try {
    const gifts = [
      {
        platformId: 'analysis-1',
        giftId: 'heart-a',
        giftName: 'Heart A',
        uid: '42',
        userName: 'Alice',
        num: 2,
        totalPrice: 20,
        blindBoxName: '心动盲盒',
        blindBoxPrice: 10,
      },
      {
        platformId: 'analysis-2',
        giftId: 'lucky-a',
        giftName: 'Lucky A',
        uid: '42',
        userName: 'Alice',
        num: 1,
        totalPrice: 4,
        blindBoxName: '幸运盲盒',
        blindBoxPrice: 8,
      },
      {
        platformId: 'analysis-3',
        giftId: 'heart-b',
        giftName: 'Heart B',
        uid: '84',
        userName: 'Bob',
        num: 3,
        totalPrice: 30,
        blindBoxName: '心动盲盒',
        blindBoxPrice: 18,
      },
    ];
    gifts.forEach((gift, index) =>
      service.add({
        ...gift,
        cmd: 'BLIND_GIFT',
        unitPrice: gift.totalPrice / gift.num,
        isBlindBox: true,
        messageTimestamp: Date.now() + index,
      }),
    );
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 1, 0);
    service.add({
      platformId: 'analysis-future',
      cmd: 'BLIND_GIFT',
      giftId: 'future-output',
      giftName: 'Future Output',
      uid: 'future',
      userName: 'Future Viewer',
      num: 10,
      unitPrice: 10,
      totalPrice: 100,
      isBlindBox: true,
      blindBoxName: '未来盲盒',
      blindBoxPrice: 50,
      messageTimestamp: tomorrow.getTime(),
    });

    const users = getBlindBoxAnalysis(context, { view: 'users' });
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

    const aliceKey = users.filters.viewers.find(
      (item) => item.label === 'Alice',
    ).value;
    const aliceBoxes = getBlindBoxAnalysis(context, {
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

    const aliceHeartRecords = getBlindBoxAnalysis(context, {
      viewer: aliceKey,
      box: '心动盲盒',
      view: 'records',
      page: 1,
      limit: 1,
    });
    assert.equal(aliceHeartRecords.summary.boxCount, 2);
    assert.equal(aliceHeartRecords.pagination.total, 1);
    assert.equal(aliceHeartRecords.pagination.totalPages, 1);
    assert.equal(aliceHeartRecords.items[0].giftName, 'Heart A');
    assert.equal(aliceHeartRecords.items[0].num, 2);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('blind box analysis bounds pagination and ignores unsupported sort fields', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-blind-pagination-'),
  );
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  };
  const service = createGiftService(context);

  try {
    for (let index = 0; index < 3; index += 1) {
      service.add({
        platformId: `page-${index}`,
        cmd: 'BLIND_GIFT',
        giftId: `gift-${index}`,
        giftName: `Gift ${index}`,
        uid: '42',
        userName: 'Alice',
        num: 1,
        unitPrice: index + 1,
        totalPrice: index + 1,
        isBlindBox: true,
        blindBoxName: '心动盲盒',
        blindBoxPrice: 1,
        messageTimestamp: Date.now() + index,
      });
    }

    const result = getBlindBoxAnalysis(context, {
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
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      3,
    );
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gift database v3 identity migration remains intact after later migrations', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-v3-'),
  );
  let db = createDatabases({ dataDir });

  try {
    db.giftDb.exec('DROP INDEX idx_gift_events_platform_uid');
    db.giftDb
      .prepare("UPDATE schema_version SET version = 2 WHERE key = 'gift_db'")
      .run();
    const insert = db.giftDb.prepare(`
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, counted_in_sprint,
        status, created_at, updated_at
      ) VALUES (?, 'SEND_GIFT', '1', 'Rose', ?, ?, ?, ?, ?, 1, 'active', ?, ?)
    `);
    const createdAt = new Date().toISOString();
    insert.run(
      'duplicate-platform',
      '42',
      'Alice',
      1,
      1,
      1,
      createdAt,
      createdAt,
    );
    insert.run(
      'duplicate-platform',
      '42',
      'Alice Renamed',
      5,
      1,
      5,
      createdAt,
      createdAt,
    );
    insert.run(
      'duplicate-platform',
      '43',
      'Bob',
      1,
      1,
      1,
      createdAt,
      createdAt,
    );
    closeDatabases(db);

    db = createDatabases({ dataDir });
    assert.equal(getSchemaVersions(db).giftDb, 8);
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
    assert.throws(
      () => insertDuplicateGift(db.giftDb, createdAt),
      /UNIQUE constraint failed/,
    );
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

test('V2 repair merges into an existing composite gift identity', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-v2-repair-'),
  );
  const db = createDatabases({ dataDir });
  const createdAt = new Date().toISOString();
  const packet = {
    cmd: 'SEND_GIFT_V2',
    data: {
      tid: 'v2-existing',
      coin_type: 'gold',
      gift_id: 1,
      gift_name: 'Rose',
      num: 2,
      price: 1000,
      total_coin: 2000,
      uid: 42,
      uname: 'Alice Renamed',
      timestamp: Date.now(),
    },
  };

  try {
    db.giftDb
      .prepare(
        `
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, counted_in_sprint,
        status, raw_json, created_at, updated_at
      ) VALUES ('v2-existing', 'SEND_GIFT', '1', 'Rose', '42', 'Alice',
        1, 1, 1, 1, 'active', '', ?, ?)
    `,
      )
      .run(createdAt, createdAt);
    db.giftDb
      .prepare(
        `
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, counted_in_sprint,
        status, raw_json, created_at, updated_at
      ) VALUES ('', 'SEND_GIFT_V2', '', '', '', '观众',
        1, 0, 0, 0, 'active', ?, ?, ?)
    `,
      )
      .run(JSON.stringify(packet), createdAt, createdAt);

    repairGiftV2Events({ db });

    const rows = db.giftDb
      .prepare('SELECT * FROM gift_events ORDER BY id')
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].platform_id, 'v2-existing');
    assert.equal(rows[0].uid, '42');
    assert.equal(rows[0].num, 2);
    assert.equal(rows[0].total_price, 2);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
