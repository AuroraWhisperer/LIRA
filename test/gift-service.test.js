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
  repairGiftV2Events
} = require('../src/bilibili/gift');
const { closeDatabases, createDatabases, getSchemaVersions } = require('../src/storage/database');

test('final SEND_GIFT combos flush on timer expiry and service disposal', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-service-'));
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null
  };
  let clockMs = 1_800_000_000_000;
  let activeTimer = null;
  const flushed = [];
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  }, {
    now: () => clockMs,
    setTimeout(callback, delay) {
      activeTimer = { callback, delay, unref() {} };
      return activeTimer;
    },
    clearTimeout(timer) {
      if (activeTimer === timer) activeTimer = null;
    },
    onGiftFlushed: (item) => flushed.push(item)
  });

  try {
    const result = service.add({
      platformId: 'combo:test:1800000000000',
      cmd: 'SEND_GIFT',
      giftId: '1',
      giftName: 'Rose',
      uid: '42',
      userName: 'Alice',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: clockMs
    });

    assert.equal(result, null);
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 0);
    assert.ok(activeTimer);

    const timer = activeTimer;
    activeTimer = null;
    clockMs += timer.delay;
    timer.callback();

    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 1);
    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].gift_name, 'Rose');
    assert.equal(
      db.giftDb.prepare('SELECT created_at FROM gift_events WHERE gift_name = ?').get('Rose').created_at,
      new Date(1_800_000_000_000).toISOString()
    );
    assert.equal(activeTimer, null);

    service.add({
      platformId: 'combo:second:1800000010000',
      cmd: 'SEND_GIFT',
      giftId: '2',
      giftName: 'Heart',
      uid: '42',
      userName: 'Alice',
      num: 1,
      unitPrice: 2,
      totalPrice: 2,
      messageTimestamp: clockMs
    });
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 1);

    service.dispose();

    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 2);
    assert.equal(flushed.length, 2);
    assert.equal(flushed[1].gift_name, 'Heart');
    assert.equal(activeTimer, null);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('COMBO_SEND with amount but no coin_type is stored as a paid gift', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-combo-paid-'));
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });

  try {
    const gift = packetParser.extractBilibiliGiftMessage({
      cmd: 'COMBO_SEND',
      data: {
        batch_combo_id: 'batch:gift:combo_id:3493090830584635:1000:31036:1785831752.2376',
        batch_combo_num: 2,
        combo_num: 2,
        combo_total_coin: 200,
        gift_id: 31036,
        gift_name: '小花花',
        gift_num: 0,
        uid: 3493090830584635,
        uname: 'Alice',
        timestamp: 1_785_831_752
      }
    });

    assert.equal(gift.coinType, '');
    assert.equal(gift.totalPrice, 0.2);
    const result = service.add(gift);
    assert.equal(result.total_price, 0.2);
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 1);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('consecutive SEND_GIFT packets merge using Bilibili combo progress', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-combo-'));
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });

  try {
    for (let comboNum = 1; comboNum <= 5; comboNum += 1) {
      const gift = packetParser.extractBilibiliGiftMessage({
        cmd: 'SEND_GIFT',
        data: {
          batch_combo_id: 'batch:gift:combo_id:42:1000:33988:1800000000.1000',
          batch_combo_send: { batch_combo_num: comboNum },
          coin_type: 'gold',
          combo_total_coin: comboNum * 100,
          giftId: 33988,
          giftName: '人气票',
          num: 1,
          price: 100,
          tid: String(9_000_000_000_000 + comboNum),
          total_coin: 100,
          uid: 42,
          uname: 'Alice',
          timestamp: 1_800_000_000 + comboNum / 10
        }
      });

      assert.equal(gift.comboNum, comboNum);
      assert.equal(gift.comboTotalPrice, comboNum / 10);
      service.add(gift);
    }

    const finalGift = packetParser.extractBilibiliGiftMessage({
      cmd: 'COMBO_SEND',
      data: {
        batch_combo_id: 'batch:gift:combo_id:42:1000:33988:1800000000.1000',
        batch_combo_num: 5,
        coin_type: 'gold',
        combo_num: 5,
        combo_total_coin: 500,
        gift_id: 33988,
        gift_name: '人气票',
        gift_num: 0,
        price: 100,
        uid: 42,
        uname: 'Alice',
        timestamp: 1_800_000_001
      }
    });
    const result = service.add(finalGift);

    const rows = db.giftDb.prepare('SELECT * FROM gift_events').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].gift_name, '人气票');
    assert.equal(rows[0].num, 5);
    assert.equal(rows[0].unit_price, 0.1);
    assert.equal(rows[0].total_price, 0.5);
    assert.equal(result.num, 5);
    assert.equal(result.total_price, 0.5);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('COMBO_END does not create a second gift event', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-combo-end-'));
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });

  try {
    const gift = packetParser.extractBilibiliGiftMessage({
      cmd: 'SEND_GIFT',
      data: {
        batch_combo_id: 'batch:gift:combo_id:288594073:3546743115352784:34001:1785831752.2376',
        coin_type: 'gold',
        giftId: 34001,
        giftName: '粉丝团灯牌',
        num: 1,
        price: 100,
        total_coin: 100,
        uid: 288594073,
        uname: 'Alice',
        timestamp: 1_785_831_752
      }
    });
    const comboEnd = {
      cmd: 'COMBO_END',
      data: {
        coin_type: 'gold',
        gift_id: 34001,
        gift_name: '粉丝团灯牌',
        num: 1,
        price: 100,
        total_coin: 100,
        uid: 288594073,
        uname: 'Alice'
      }
    };

    assert.equal(service.add(gift), null);
    assert.equal(packetParser.isBilibiliGiftLikeCommand(comboEnd.cmd, new Set()), false);
    assert.equal(packetParser.extractBilibiliGiftMessage(comboEnd), null);

    service.dispose();

    const rows = db.giftDb.prepare('SELECT * FROM gift_events').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cmd, 'SEND_GIFT');
    assert.equal(rows[0].gift_name, '粉丝团灯牌');
    assert.equal(rows[0].total_price, 0.1);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('distinct SEND_GIFT message ids are not treated as retransmissions', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-distinct-'));
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });

  try {
    for (let index = 1; index <= 5; index += 1) {
      service.add({
        platformId: `gift-message-${index}`,
        cmd: 'SEND_GIFT',
        giftId: '33988',
        giftName: '人气票',
        uid: '42',
        userName: 'Alice',
        num: 1,
        unitPrice: 0.1,
        totalPrice: 0.1,
        messageTimestamp: 1_800_000_000_000 + index * 100
      });
    }

    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 5);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('logs whether a repeated platform gift was inserted or deduplicated', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-diagnostics-'));
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });
  const originalLog = console.log;
  const logs = [];

  try {
    console.log = (line) => logs.push(String(line));
    const gift = {
      platformId: 'gift-repeat-1',
      cmd: 'SEND_GIFT',
      giftId: '1',
      giftName: 'Rose',
      uid: '42',
      userName: 'Alice',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: 1_800_000_000_000
    };

    const inserted = service.add(gift);
    const duplicate = service.add(gift);

    assert.equal(inserted.id, duplicate.id);
    assert.match(logs[0], /^\[Bilibili\]\[GiftService\] action=inserted /);
    assert.match(logs[0], /"eventId":1/);
    assert.match(logs[0], /"platformId":"gift-repeat-1"/);
    assert.match(logs[1], /^\[Bilibili\]\[GiftService\] action=deduplicated reason=platform-id /);
    assert.match(logs[1], /"eventId":1/);
  } finally {
    console.log = originalLog;
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('same platform id and uid deduplicate even when the user name changes', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-uid-dedupe-'));
  const db = createDatabases({ dataDir });
  const service = createGiftService({
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });

  try {
    const base = {
      platformId: 'shared-platform-id',
      cmd: 'SEND_GIFT',
      giftId: '1',
      giftName: 'Rose',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: Date.now()
    };
    const first = service.add({ ...base, uid: '42', userName: 'Alice' });
    const renamed = service.add({ ...base, uid: '42', userName: 'Alice Renamed' });
    const otherUser = service.add({ ...base, uid: '43', userName: 'Bob' });

    assert.equal(renamed.id, first.id);
    assert.notEqual(otherUser.id, first.id);
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 2);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('separate combo batches keep their timestamp in the buffer key', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-combo-batches-'));
  const db = createDatabases({ dataDir });
  const state = { giftComboPending: new Map(), blindBoxCache: null };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });

  try {
    for (const timestamp of ['1800000000.1000', '1800000005.1000']) {
      service.add({
        platformId: `batch:gift:combo_id:42:1000:33988:${timestamp}`,
        cmd: 'SEND_GIFT',
        giftId: '33988',
        giftName: 'Ticket',
        uid: '42',
        userName: 'Alice',
        num: 1,
        unitPrice: 0.1,
        totalPrice: 0.1,
        messageTimestamp: Date.now()
      });
    }

    assert.equal(state.giftComboPending.size, 2);
    service.dispose();
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 2);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('explicit silver and free combo gifts are not inferred as paid from amount fields', () => {
  for (const coinType of ['silver', 'free']) {
    const gift = packetParser.extractBilibiliGiftMessage({
      cmd: 'COMBO_SEND',
      data: {
        batch_combo_id: `batch:gift:combo_id:42:1000:1:1800000000.${coinType.length}`,
        combo_num: 2,
        combo_total_coin: 200,
        coin_type: coinType,
        gift_id: 1,
        gift_name: 'Free Gift',
        uid: 42,
        uname: 'Alice'
      }
    });

    assert.equal(gift.coinType, coinType);
    assert.equal(gift.totalPrice, 0);
    assert.equal(gift.comboTotalPrice, 0);
  }
});

test('blind box statistics count gift quantity and include record ids', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-blind-count-'));
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
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
      messageTimestamp: Date.now()
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-blind-filter-'));
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
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
      messageTimestamp: Date.now()
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
      messageTimestamp: Date.now()
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-blind-analysis-'));
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  };
  const service = createGiftService(context);

  try {
    const gifts = [
      { platformId: 'analysis-1', giftId: 'heart-a', giftName: 'Heart A', uid: '42', userName: 'Alice', num: 2, totalPrice: 20, blindBoxName: '心动盲盒', blindBoxPrice: 10 },
      { platformId: 'analysis-2', giftId: 'lucky-a', giftName: 'Lucky A', uid: '42', userName: 'Alice', num: 1, totalPrice: 4, blindBoxName: '幸运盲盒', blindBoxPrice: 8 },
      { platformId: 'analysis-3', giftId: 'heart-b', giftName: 'Heart B', uid: '84', userName: 'Bob', num: 3, totalPrice: 30, blindBoxName: '心动盲盒', blindBoxPrice: 18 }
    ];
    gifts.forEach((gift, index) => service.add({
      ...gift,
      cmd: 'BLIND_GIFT',
      unitPrice: gift.totalPrice / gift.num,
      isBlindBox: true,
      messageTimestamp: Date.now() + index
    }));
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
      messageTimestamp: tomorrow.getTime()
    });

    const users = getBlindBoxAnalysis(context, { view: 'users' });
    assert.equal(users.summary.boxCount, 6);
    assert.equal(users.summary.totalCost, 36);
    assert.equal(users.summary.totalValue, 54);
    assert.equal(users.summary.totalProfit, 18);
    assert.equal(users.items.length, 2);
    assert.deepEqual(users.items.map(item => item.userName), ['Bob', 'Alice']);
    assert.deepEqual(users.filters.viewers.map(item => item.label), ['Alice', 'Bob']);
    assert.deepEqual(users.filters.boxes, ['心动盲盒', '幸运盲盒']);

    const aliceKey = users.filters.viewers.find(item => item.label === 'Alice').value;
    const aliceBoxes = getBlindBoxAnalysis(context, {
      viewer: aliceKey,
      view: 'boxes',
      sort: 'boxCount',
      direction: 'desc'
    });
    assert.equal(aliceBoxes.summary.boxCount, 3);
    assert.equal(aliceBoxes.summary.totalProfit, 6);
    assert.deepEqual(aliceBoxes.items.map(item => item.boxName), ['心动盲盒', '幸运盲盒']);

    const aliceHeartRecords = getBlindBoxAnalysis(context, {
      viewer: aliceKey,
      box: '心动盲盒',
      view: 'records',
      page: 1,
      limit: 1
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-blind-pagination-'));
  const db = createDatabases({ dataDir });
  const context = {
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
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
        messageTimestamp: Date.now() + index
      });
    }

    const result = getBlindBoxAnalysis(context, {
      view: 'records',
      page: 2,
      limit: 2,
      sort: 'DROP TABLE gift_events',
      direction: 'sideways'
    });
    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.limit, 2);
    assert.equal(result.pagination.total, 3);
    assert.equal(result.pagination.totalPages, 2);
    assert.equal(result.items.length, 1);
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 3);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gift database v3 migration collapses duplicate identities and adds a unique constraint', () => {
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
    assert.equal(getSchemaVersions(db).giftDb, 3);
    const rows = db.giftDb.prepare(`
      SELECT * FROM gift_events WHERE platform_id = ? ORDER BY uid
    `).all('duplicate-platform');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].uid, '42');
    assert.equal(rows[0].user_name, 'Alice Renamed');
    assert.equal(rows[0].num, 5);
    assert.equal(rows[0].total_price, 5);
    assert.equal(rows[1].uid, '43');
    assert.throws(
      () => insertDuplicateGift(db.giftDb, createdAt),
      /UNIQUE constraint failed/
    );
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function insertDuplicateGift(giftDb, createdAt) {
  giftDb.prepare(`
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name, uid, user_name,
      num, unit_price, total_price, status, created_at, updated_at
    ) VALUES ('duplicate-platform', 'SEND_GIFT', '1', 'Rose', '42', 'Alice',
      1, 1, 1, 'active', ?, ?)
  `).run(createdAt, createdAt);
}

test('V2 repair merges into an existing composite gift identity', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-v2-repair-'));
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
      timestamp: Date.now()
    }
  };

  try {
    db.giftDb.prepare(`
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, counted_in_sprint,
        status, raw_json, created_at, updated_at
      ) VALUES ('v2-existing', 'SEND_GIFT', '1', 'Rose', '42', 'Alice',
        1, 1, 1, 1, 'active', '', ?, ?)
    `).run(createdAt, createdAt);
    db.giftDb.prepare(`
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, counted_in_sprint,
        status, raw_json, created_at, updated_at
      ) VALUES ('', 'SEND_GIFT_V2', '', '', '', '观众',
        1, 0, 0, 0, 'active', ?, ?, ?)
    `).run(JSON.stringify(packet), createdAt, createdAt);

    repairGiftV2Events({ db });

    const rows = db.giftDb.prepare('SELECT * FROM gift_events ORDER BY id').all();
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
