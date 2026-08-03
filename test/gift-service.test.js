'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const packetParser = require('../src/bilibili/packet-parser');
const { createGiftService } = require('../src/bilibili/gift-service');
const { closeDatabases, createDatabases } = require('../src/storage/database');

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
