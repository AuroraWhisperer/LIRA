'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const packetParser = require('../src/bilibili/packet-parser');
const { createGiftService } = require('../src/bilibili/gift-service');
const { closeDatabases, createDatabases } = require('../src/storage/database');

function withGiftService(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-guard-'));
  const db = createDatabases({ dataDir });
  const service = createGiftService({
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });

  try {
    run({ db, service });
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function guardToast({ uid, price, payflowId, num = 1, level = 3, startTime = 1_800_000_000 }) {
  return {
    cmd: 'USER_TOAST_MSG_V2',
    data: {
      sender_uinfo: { uid, base: { name: `Viewer ${uid}` } },
      guard_info: { guard_level: level, start_time: startTime },
      pay_info: { price, num, unit: '月', payflow_id: payflowId },
      gift_info: { gift_id: 10000 + level }
    }
  };
}

test('GUARD_BUY list price is ignored and toast actual prices are stored', () => {
  const guardBuy = packetParser.extractBilibiliGiftMessage({
    cmd: 'GUARD_BUY',
    data: {
      uid: 42,
      username: 'Alice',
      guard_level: 3,
      num: 1,
      price: 198000,
      gift_id: 10003,
      gift_name: '舰长',
      start_time: 1_800_000_000
    }
  });
  assert.equal(guardBuy, null);

  withGiftService(({ db, service }) => {
    const legacyToast = packetParser.extractBilibiliGiftMessage({
      cmd: 'USER_TOAST_MSG',
      data: {
        uid: 42,
        username: 'Alice',
        guard_level: 3,
        num: 1,
        price: 138000,
        gift_id: 10003,
        role_name: '舰长',
        start_time: 1_800_000_000,
        payflow_id: 'order-42'
      }
    });
    const duplicateV2 = packetParser.extractBilibiliGiftMessage(guardToast({
      uid: 42,
      price: 138000,
      payflowId: 'order-42'
    }));
    const discounted168 = packetParser.extractBilibiliGiftMessage(guardToast({
      uid: 43,
      price: 168000,
      payflowId: 'order-43'
    }));
    const fullPrice = packetParser.extractBilibiliGiftMessage(guardToast({
      uid: 44,
      price: 198000,
      payflowId: 'order-44'
    }));

    for (const gift of [legacyToast, duplicateV2, discounted168, fullPrice]) service.add(gift);

    const rows = db.giftDb.prepare('SELECT * FROM gift_events ORDER BY id').all();
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.total_price), [138, 168, 198]);
  });
});

test('multi-month guard toast keeps the order total and month count', () => {
  const cases = [
    { num: 3, price: 534000, totalPrice: 534 },
    { num: 3, price: 504000, totalPrice: 504 },
    { num: 6, price: 1008000, totalPrice: 1008 }
  ];

  for (const [index, item] of cases.entries()) {
    const gift = packetParser.extractBilibiliGiftMessage(guardToast({
      uid: 100 + index,
      price: item.price,
      num: item.num,
      payflowId: `multi-month-${index}`
    }));
    assert.equal(gift.giftName, '舰长');
    assert.equal(gift.num, item.num);
    assert.equal(gift.unitPrice, item.totalPrice);
    assert.equal(gift.totalPrice, item.totalPrice);
  }
});

test('guard levels identify prefect and governor independently of price', () => {
  const prefect = packetParser.extractBilibiliGiftMessage(guardToast({
    uid: 201,
    price: 1998000,
    payflowId: 'prefect-201',
    level: 2
  }));
  const governor = packetParser.extractBilibiliGiftMessage(guardToast({
    uid: 202,
    price: 19998000,
    payflowId: 'governor-202',
    level: 1
  }));

  assert.equal(prefect.giftName, '提督');
  assert.equal(prefect.giftId, '10002');
  assert.equal(prefect.totalPrice, 1998);
  assert.equal(governor.giftName, '总督');
  assert.equal(governor.giftId, '10001');
  assert.equal(governor.totalPrice, 19998);
});

test('distinct guard payflow ids in the same second are added separately', () => {
  withGiftService(({ db, service }) => {
    const fullPrice = packetParser.extractBilibiliGiftMessage(guardToast({
      uid: 300,
      price: 198000,
      payflowId: 'order-300-a'
    }));
    const discounted = packetParser.extractBilibiliGiftMessage(guardToast({
      uid: 300,
      price: 138000,
      payflowId: 'order-300-b'
    }));
    assert.notEqual(fullPrice.platformId, discounted.platformId);

    service.add(fullPrice);
    service.add(discounted);

    const rows = db.giftDb.prepare('SELECT * FROM gift_events ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.total_price), [198, 138]);
    assert.equal(rows.reduce((sum, row) => sum + row.total_price, 0), 336);
  });
});
