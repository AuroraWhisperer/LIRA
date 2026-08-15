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

    assert.equal(result.detection_status, 'progress');
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 1);
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
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 2);

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

    assert.equal(service.add(gift).detection_status, 'progress');
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
    assert.match(logs[1], /^\[Bilibili\]\[GiftService\] action=deduplicated reason=final-event /);
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

    assert.equal(
      db.giftDb.prepare("SELECT COUNT(*) AS count FROM gift_events WHERE detection_status = 'progress'").get().count,
      2
    );
    service.dispose();
    assert.equal(db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 2);
    assert.equal(
      db.giftDb.prepare("SELECT COUNT(*) AS count FROM gift_events WHERE detection_status = 'final'").get().count,
      2
    );
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
