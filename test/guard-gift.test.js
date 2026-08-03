'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const packetParser = require('../src/bilibili/packet-parser');
const { createGiftService } = require('../src/bilibili/gift-service');
const { closeDatabases, createDatabases } = require('../src/storage/database');

test('guard protocol variants are stored once at the purchase price', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-guard-gift-'));
  const db = createDatabases({ dataDir });
  const service = createGiftService({
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' })
  });
  const startTime = 1_800_000_000;

  const packets = [
    {
      cmd: 'GUARD_BUY',
      data: {
        uid: 42,
        username: 'Alice',
        guard_level: 3,
        num: 1,
        price: 198000,
        gift_id: 10003,
        gift_name: '舰长',
        start_time: startTime
      }
    },
    {
      cmd: 'USER_TOAST_MSG',
      data: {
        uid: 42,
        username: 'Alice',
        guard_level: 3,
        num: 1,
        price: 138000,
        gift_id: 10003,
        role_name: '舰长',
        start_time: startTime,
        payflow_id: 'order-42'
      }
    },
    {
      cmd: 'USER_TOAST_MSG_V2',
      data: {
        sender_uinfo: { uid: 42, base: { name: 'Alice' } },
        guard_info: { guard_level: 3, role_name: '舰长', start_time: startTime },
        pay_info: { price: 138000, num: 1, payflow_id: 'order-42' },
        gift_info: { gift_id: 10003 }
      }
    }
  ];

  try {
    const gifts = packets.map(packetParser.extractBilibiliGiftMessage);
    assert.equal(gifts[0].platformId, gifts[1].platformId);
    assert.equal(gifts[1].platformId, gifts[2].platformId);
    assert.equal(gifts[0].totalPrice, 198);
    assert.equal(gifts[1].totalPrice, 138);
    assert.equal(gifts[2].totalPrice, 138);

    for (const gift of gifts) service.add(gift);

    const rows = db.giftDb.prepare('SELECT * FROM gift_events').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total_price, 198);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
