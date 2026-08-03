'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createGiftService } = require('../src/bilibili/gift-service');
const { closeDatabases, createDatabases } = require('../src/storage/database');

test('final SEND_GIFT combos flush on timer expiry and service disposal', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-service-'));
  const db = createDatabases({ dataDir });
  const state = {
    giftBotPendingByName: new Map(),
    giftBotLastReportByName: new Map(),
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
