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
const { createGiftEventStore } = require('../src/storage/gift-event-store');

// Keep the regression payload synthetic. It mirrors the captured V2 field
// layout without carrying any live user's identifiers, names, or URLs.
function encodeProtoVarint(value) {
  let number = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(number & 0x7fn);
    number >>= 7n;
    if (number > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (number > 0n);
  return Buffer.from(bytes);
}

function encodeProtoField(field, value) {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return Buffer.concat([
      encodeProtoVarint(field << 3),
      encodeProtoVarint(value),
    ]);
  }

  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return Buffer.concat([
    encodeProtoVarint((field << 3) | 2),
    encodeProtoVarint(bytes.length),
    bytes,
  ]);
}

function encodeProtoMessage(fields) {
  return Buffer.concat(
    fields.map(([field, value]) => encodeProtoField(field, value)),
  );
}

function buildGiftV2Fixture({
  giftId = '30706',
  giftName = '生日快乐',
  num = 1,
  giftType = 2,
  unitCoin = 1000,
  totalCoin = 1000,
  comboCount = 1,
  comboTotalCoin = 1000,
  tid = 'tid:test',
  comboId = 'batch:gift:combo_id:test:30706:1',
} = {}) {
  const giftInfo = encodeProtoMessage([
    [1, giftId],
    [2, giftName],
    [3, num],
    [4, giftType],
    [5, unitCoin],
    [7, totalCoin],
    [8, 'gold'],
    [9, tid],
    [10, 1_788_009_073],
    [11, comboCount],
    [12, comboId],
    [14, comboTotalCoin],
  ]);
  return encodeProtoMessage([
    [1, '42'],
    [2, '测试观众'],
    [10, giftInfo],
  ]).toString('base64');
}

const SEND_GIFT_V2_COMBO_ID = 'batch:gift:combo_id:test:30706:1';
const SEND_GIFT_V2_FIXTURES = Object.freeze([
  buildGiftV2Fixture({
    tid: 'tid:test:1',
    comboCount: 1,
    comboTotalCoin: 1000,
  }),
  buildGiftV2Fixture({
    tid: 'tid:test:2',
    comboCount: 2,
    comboTotalCoin: 2000,
  }),
]);
const SEND_GIFT_V2_BATCH_FIXTURE = buildGiftV2Fixture({
  giftId: '33988',
  giftName: '人气票',
  num: 10,
  unitCoin: 100,
  totalCoin: 1000,
  comboCount: 2,
  comboTotalCoin: 2000,
  tid: 'tid:test:batch',
  comboId: 'batch:gift:combo_id:test:33988:2',
});

test('final SEND_GIFT combos flush on timer expiry and service disposal', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-service-'),
  );
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null,
  };
  let clockMs = 1_800_000_000_000;
  let activeTimer = null;
  const flushed = [];
  const service = createGiftService(
    {
      db,
      state,
      settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    },
    {
      now: () => clockMs,
      setTimeout(callback, delay) {
        activeTimer = { callback, delay, unref() {} };
        return activeTimer;
      },
      clearTimeout(timer) {
        if (activeTimer === timer) activeTimer = null;
      },
      onGiftFlushed: (item) => flushed.push(item),
    },
  );

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
      messageTimestamp: clockMs,
    });

    assert.equal(result.detection_status, 'progress');
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      1,
    );
    assert.ok(activeTimer);

    const timer = activeTimer;
    activeTimer = null;
    clockMs += timer.delay;
    timer.callback();

    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      1,
    );
    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].gift_name, 'Rose');
    assert.equal(
      db.giftDb
        .prepare('SELECT created_at FROM gift_events WHERE gift_name = ?')
        .get('Rose').created_at,
      new Date(1_800_000_000_000).toISOString(),
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
      messageTimestamp: clockMs,
    });
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      2,
    );

    service.dispose();

    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      2,
    );
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
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-combo-paid-'),
  );
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null,
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  });

  try {
    const gift = packetParser.extractBilibiliGiftMessage({
      cmd: 'COMBO_SEND',
      data: {
        batch_combo_id:
          'batch:gift:combo_id:3493090830584635:1000:31036:1785831752.2376',
        batch_combo_num: 2,
        combo_num: 2,
        combo_total_coin: 200,
        gift_id: 31036,
        gift_name: '小花花',
        gift_num: 0,
        uid: 3493090830584635,
        uname: 'Alice',
        timestamp: 1_785_831_752,
      },
    });

    assert.equal(gift.coinType, '');
    assert.equal(gift.totalPrice, 0.2);
    const result = service.add(gift);
    assert.equal(result.total_price, 0.2);
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      1,
    );
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a V2 combo carrying only cumulative price is not dropped as a free gift', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-v2-cumulative-only-'),
  );
  const db = createDatabases({ dataDir });
  const service = createGiftService({
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  });

  try {
    const gift = packetParser.extractBilibiliGiftMessage({
      cmd: 'SEND_GIFT_V2',
      data: {
        pb: buildGiftV2Fixture({
          unitCoin: 0,
          totalCoin: 0,
          comboCount: 2,
          comboTotalCoin: 2000,
          tid: 'tid:cumulative-only',
          comboId: 'batch:gift:combo_id:test:cumulative-only',
        }),
      },
    });
    assert.equal(gift.totalPrice, 0);
    assert.equal(gift.comboTotalPrice, 2);
    const result = service.add(gift);
    assert.equal(result.total_price, 2);
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      1,
    );
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('consecutive SEND_GIFT packets merge using Bilibili combo progress', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-combo-'),
  );
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null,
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
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
          timestamp: 1_800_000_000 + comboNum / 10,
        },
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
        timestamp: 1_800_000_001,
      },
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

test('SEND_GIFT_V2 exposes package and cumulative combo fields from protobuf', () => {
  const gifts = SEND_GIFT_V2_FIXTURES.map((pb) =>
    packetParser.extractBilibiliGiftMessage({
      cmd: 'SEND_GIFT_V2',
      data: { pb },
    }),
  );

  assert.equal(gifts.length, 2);
  assert.equal(gifts[0].giftId, '30706');
  assert.equal(gifts[0].giftName, '生日快乐');
  assert.equal(gifts[0].coinType, 'gold');
  assert.equal(gifts[0].num, 1);
  assert.equal(gifts[0].unitPrice, 1);
  assert.equal(gifts[0].totalPrice, 1);
  assert.equal(gifts[0].comboNum, 1);
  assert.equal(gifts[0].comboTotalPrice, 1);
  assert.equal(gifts[0].comboId, SEND_GIFT_V2_COMBO_ID);
  assert.equal(gifts[0].platformId, SEND_GIFT_V2_COMBO_ID);

  assert.equal(gifts[1].num, 1);
  assert.equal(gifts[1].totalPrice, 1);
  assert.equal(gifts[1].comboNum, 2);
  assert.equal(gifts[1].comboTotalPrice, 2);
  assert.equal(gifts[1].comboId, SEND_GIFT_V2_COMBO_ID);
  assert.equal(gifts[1].platformId, SEND_GIFT_V2_COMBO_ID);
});

test('SEND_GIFT_V2 multiplies a batched package quantity by its combo count', () => {
  const gift = packetParser.extractBilibiliGiftMessage({
    cmd: 'SEND_GIFT_V2',
    data: { pb: SEND_GIFT_V2_BATCH_FIXTURE },
  });

  assert.equal(gift.num, 10);
  assert.equal(gift.comboNum, 20);
  assert.equal(gift.totalPrice, 1);
  assert.equal(gift.comboTotalPrice, 2);
});

test('V2 repair migrates positive legacy identities before a COMBO_SEND final', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-v2-positive-repair-'),
  );
  const db = createDatabases({ dataDir });
  const packet = {
    cmd: 'SEND_GIFT_V2',
    data: { pb: SEND_GIFT_V2_FIXTURES[0] },
  };
  const rawJson = JSON.stringify(packet);
  const detectedAtMs = Date.now();
  const createdAt = new Date(detectedAtMs).toISOString();
  let service = null;

  try {
    // This row represents the pre-fix parser, which persisted the unique V2
    // tid even though the event already had a positive price.
    db.giftDb
      .prepare(
        `
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, coin_type, detection_status,
        first_detected_at_ms, last_platform_at_ms, status, raw_json,
        created_at, updated_at
      ) VALUES (?, 'SEND_GIFT_V2', '30706', '生日快乐', '42', '测试观众',
        1, 1, 1, 'gold', 'progress', ?, ?, 'active', ?, ?, ?)
    `,
      )
      .run(
        'tid:legacy-positive',
        detectedAtMs,
        detectedAtMs,
        rawJson,
        createdAt,
        createdAt,
      );

    repairGiftV2Events({ db });
    const repaired = db.giftDb.prepare('SELECT * FROM gift_events').get();
    assert.equal(repaired.platform_id, SEND_GIFT_V2_COMBO_ID);
    assert.equal(repaired.total_price, 1);

    service = createGiftService({
      db,
      state: { giftComboPending: new Map(), blindBoxCache: null },
      settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    });
    const finalGift = packetParser.extractBilibiliGiftMessage({
      cmd: 'COMBO_SEND',
      data: {
        batch_combo_id: SEND_GIFT_V2_COMBO_ID,
        batch_combo_num: 2,
        coin_type: 'gold',
        combo_num: 2,
        combo_total_coin: 2000,
        gift_id: 30706,
        gift_name: '生日快乐',
        gift_num: 1,
        price: 1000,
        total_coin: 1000,
        uid: 42,
        uname: '测试用户',
        timestamp: 1_788_009_074,
      },
    });
    const result = service.add(finalGift);
    const rows = db.giftDb.prepare('SELECT * FROM gift_events').all();
    assert.equal(rows.length, 1);
    assert.equal(result.detection_status, 'final');
    assert.equal(result.num, 2);
    assert.equal(result.total_price, 2);
  } finally {
    service?.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('V2 repair applies cumulative-only combo totals before a COMBO_SEND final', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-v2-cumulative-repair-'),
  );
  const db = createDatabases({ dataDir });
  const packet = {
    cmd: 'SEND_GIFT_V2',
    data: {
      pb: buildGiftV2Fixture({
        unitCoin: 0,
        totalCoin: 0,
        comboCount: 2,
        comboTotalCoin: 2000,
        tid: 'tid:cumulative-only-repair',
        comboId: 'batch:gift:combo_id:test:cumulative-only-repair',
      }),
    },
  };
  const rawJson = JSON.stringify(packet);
  const detectedAtMs = Date.now();
  const createdAt = new Date(detectedAtMs).toISOString();
  let service = null;

  try {
    // This is the legacy row shape: the old parser persisted the per-packet
    // amount and tid, even though the packet contains a paid cumulative combo.
    db.giftDb
      .prepare(
        `
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, coin_type, detection_status,
        first_detected_at_ms, last_platform_at_ms, status, raw_json,
        created_at, updated_at
      ) VALUES (?, 'SEND_GIFT_V2', '30706', '生日快乐', '42', '测试观众',
        1, 0, 0, 'gold', 'progress', ?, ?, 'active', ?, ?, ?)
    `,
      )
      .run(
        'tid:cumulative-only-repair',
        detectedAtMs,
        detectedAtMs,
        rawJson,
        createdAt,
        createdAt,
      );

    repairGiftV2Events({ db });
    const repaired = db.giftDb.prepare('SELECT * FROM gift_events').get();
    assert.equal(
      repaired.platform_id,
      'batch:gift:combo_id:test:cumulative-only-repair',
    );
    assert.equal(repaired.num, 2);
    assert.equal(repaired.unit_price, 1);
    assert.equal(repaired.total_price, 2);

    service = createGiftService({
      db,
      state: { giftComboPending: new Map(), blindBoxCache: null },
      settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    });
    const finalGift = packetParser.extractBilibiliGiftMessage({
      cmd: 'COMBO_SEND',
      data: {
        batch_combo_id: 'batch:gift:combo_id:test:cumulative-only-repair',
        batch_combo_num: 2,
        combo_num: 2,
        combo_total_coin: 2000,
        gift_id: 30706,
        gift_name: '生日快乐',
        gift_num: 1,
        price: 1000,
        total_coin: 1000,
        uid: 42,
        uname: '测试用户',
        timestamp: 1_788_009_074,
      },
    });
    const result = service.add(finalGift);
    const rows = db.giftDb.prepare('SELECT * FROM gift_events').all();
    assert.equal(rows.length, 1);
    assert.equal(result.detection_status, 'final');
    assert.equal(result.num, 2);
    assert.equal(result.total_price, 2);
  } finally {
    service?.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('SEND_GIFT_V2 progress and COMBO_SEND final produce one cumulative event', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-v2-combo-'),
  );
  const db = createDatabases({ dataDir });
  const service = createGiftService({
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  });

  try {
    const progressGifts = SEND_GIFT_V2_FIXTURES.map((pb) =>
      packetParser.extractBilibiliGiftMessage({
        cmd: 'SEND_GIFT_V2',
        data: { pb },
      }),
    );
    const firstProgress = service.add(progressGifts[0]);
    const secondProgress = service.add(progressGifts[1]);

    assert.equal(firstProgress.detection_status, 'progress');
    assert.equal(secondProgress.detection_status, 'progress');
    assert.equal(secondProgress.num, 2);
    assert.equal(secondProgress.total_price, 2);
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      1,
    );

    const finalGift = packetParser.extractBilibiliGiftMessage({
      cmd: 'COMBO_SEND',
      data: {
        batch_combo_id: SEND_GIFT_V2_COMBO_ID,
        batch_combo_num: 2,
        coin_type: 'gold',
        combo_num: 2,
        combo_total_coin: 2000,
        gift_id: 30706,
        gift_name: '生日快乐',
        gift_num: 1,
        price: 1000,
        total_coin: 1000,
        uid: progressGifts[0].uid,
        uname: '测试用户',
        timestamp: 1_788_009_074,
      },
    });
    const finalResult = service.add(finalGift);
    const rows = db.giftDb.prepare('SELECT * FROM gift_events').all();

    assert.equal(finalResult.detection_status, 'final');
    assert.equal(finalResult.num, 2);
    assert.equal(finalResult.total_price, 2);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detection_status, 'final');
    assert.equal(rows[0].platform_id, SEND_GIFT_V2_COMBO_ID);
    assert.equal(rows[0].num, 2);
    assert.equal(rows[0].total_price, 2);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('COMBO_END does not create a second gift event', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-combo-end-'),
  );
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null,
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
  });

  try {
    const gift = packetParser.extractBilibiliGiftMessage({
      cmd: 'SEND_GIFT',
      data: {
        batch_combo_id:
          'batch:gift:combo_id:288594073:3546743115352784:34001:1785831752.2376',
        coin_type: 'gold',
        giftId: 34001,
        giftName: '粉丝团灯牌',
        num: 1,
        price: 100,
        total_coin: 100,
        uid: 288594073,
        uname: 'Alice',
        timestamp: 1_785_831_752,
      },
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
        uname: 'Alice',
      },
    };

    assert.equal(service.add(gift).detection_status, 'progress');
    assert.equal(
      packetParser.isBilibiliGiftLikeCommand(comboEnd.cmd, new Set()),
      false,
    );
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

test('identical gift messages use the legacy five-second deduplication window', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-distinct-'),
  );
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null,
  };
  const service = createGiftService(
    {
      db,
      state,
      settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    },
    {
      giftEventStore: createGiftEventStore(db.giftDb),
    },
  );

  try {
    const messageTimes = [
      1_800_000_000_000, 1_800_000_000_100, 1_800_000_005_101,
    ];
    const scenarios = [
      {
        cmd: 'SEND_GIFT',
        giftId: 'high-value',
        giftName: '高价礼物',
        uid: '42',
        totalPrice: 1000,
      },
      {
        cmd: 'BLIND_GIFT',
        giftId: 'blind-output',
        giftName: '盲盒结果',
        uid: '43',
        totalPrice: 20,
      },
    ];

    scenarios.forEach((scenario) => {
      messageTimes.forEach((messageTimestamp, index) => {
        service.add({
          platformId: `${scenario.cmd.toLowerCase()}-message-${index + 1}`,
          cmd: scenario.cmd,
          giftId: scenario.giftId,
          giftName: scenario.giftName,
          uid: scenario.uid,
          userName: 'Alice',
          num: 1,
          unitPrice: scenario.totalPrice,
          totalPrice: scenario.totalPrice,
          isBlindBox: scenario.cmd === 'BLIND_GIFT',
          blindBoxName: scenario.cmd === 'BLIND_GIFT' ? '测试盲盒' : '',
          blindBoxPrice: scenario.cmd === 'BLIND_GIFT' ? 10 : null,
          messageTimestamp,
        });
      });
    });

    const countByCommand = db.giftDb.prepare(
      'SELECT COUNT(*) AS count FROM gift_events WHERE cmd = ?',
    );
    assert.equal(countByCommand.get('SEND_GIFT').count, 2);
    assert.equal(countByCommand.get('BLIND_GIFT').count, 2);
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('logs whether a repeated platform gift was inserted or deduplicated', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-diagnostics-'),
  );
  const db = createDatabases({ dataDir });
  const state = {
    giftComboPending: new Map(),
    blindBoxCache: null,
  };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
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
      messageTimestamp: 1_800_000_000_000,
    };

    const inserted = service.add(gift);
    const duplicate = service.add(gift);

    assert.equal(inserted.id, duplicate.id);
    assert.match(logs[0], /^\[Bilibili\]\[GiftService\] action=inserted /);
    assert.match(logs[0], /"eventId":1/);
    assert.match(logs[0], /"platformId":"gift-repeat-1"/);
    assert.match(
      logs[1],
      /^\[Bilibili\]\[GiftService\] action=deduplicated reason=final-event /,
    );
    assert.match(logs[1], /"eventId":1/);
  } finally {
    console.log = originalLog;
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('same platform id and uid deduplicate even when the user name changes', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-uid-dedupe-'),
  );
  const db = createDatabases({ dataDir });
  const service = createGiftService({
    db,
    state: { giftComboPending: new Map(), blindBoxCache: null },
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
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
      messageTimestamp: Date.now(),
    };
    const first = service.add({ ...base, uid: '42', userName: 'Alice' });
    const renamed = service.add({
      ...base,
      uid: '42',
      userName: 'Alice Renamed',
    });
    const otherUser = service.add({ ...base, uid: '43', userName: 'Bob' });

    assert.equal(renamed.id, first.id);
    assert.notEqual(otherUser.id, first.id);
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      2,
    );
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('different explicit combo batches do not cross-command deduplicate', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-cross-batch-'),
  );
  const db = createDatabases({ dataDir });
  const service = createGiftService(
    {
      db,
      state: { giftComboPending: new Map(), blindBoxCache: null },
      settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    },
    {
      giftEventStore: createGiftEventStore(db.giftDb),
    },
  );

  try {
    const first = service.add({
      platformId: 'batch:gift:combo_id:42:1000:1:1800000000.1000',
      comboId: 'batch:gift:combo_id:42:1000:1:1800000000.1000',
      cmd: 'SEND_GIFT',
      giftId: '1',
      giftName: 'Rose',
      uid: '42',
      userName: 'Alice',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: 1_800_000_000_000,
    });
    const second = service.add({
      platformId: 'batch:gift:combo_id:42:1000:1:1800000000.2000',
      comboId: 'batch:gift:combo_id:42:1000:1:1800000000.2000',
      cmd: 'COMBO_SEND',
      giftId: '1',
      giftName: 'Rose',
      uid: '42',
      userName: 'Alice',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: 1_800_000_000_100,
    });

    assert.notEqual(second.id, first.id);
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      2,
    );
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('an explicit combo does not absorb a nearby legacy event without combo identity', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-cross-legacy-'),
  );
  const db = createDatabases({ dataDir });
  const service = createGiftService(
    {
      db,
      state: { giftComboPending: new Map(), blindBoxCache: null },
      settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    },
    {
      giftEventStore: createGiftEventStore(db.giftDb),
    },
  );

  try {
    const first = service.add({
      platformId: 'legacy-tid-1',
      cmd: 'SEND_GIFT',
      giftId: '1',
      giftName: 'Rose',
      uid: '42',
      userName: 'Alice',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: 1_800_000_000_000,
    });
    const second = service.add({
      platformId: 'batch:gift:combo_id:42:1000:1:1800000000.2000',
      comboId: 'batch:gift:combo_id:42:1000:1:1800000000.2000',
      cmd: 'COMBO_SEND',
      giftId: '1',
      giftName: 'Rose',
      uid: '42',
      userName: 'Alice',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: 1_800_000_000_100,
    });

    assert.notEqual(second.id, first.id);
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      2,
    );
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gifts without a UID from different viewers are not recent duplicates', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-missing-uid-'),
  );
  const db = createDatabases({ dataDir });
  const service = createGiftService(
    {
      db,
      state: { giftComboPending: new Map(), blindBoxCache: null },
      settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    },
    {
      giftEventStore: createGiftEventStore(db.giftDb),
    },
  );

  try {
    const base = {
      cmd: 'SEND_GIFT',
      giftId: '1',
      giftName: 'Rose',
      uid: '',
      num: 1,
      unitPrice: 1,
      totalPrice: 1,
      messageTimestamp: 1_800_000_000_000,
    };
    const first = service.add({
      ...base,
      platformId: 'send-gift-without-uid-a',
      userName: 'Alice',
    });
    const second = service.add({
      ...base,
      platformId: 'send-gift-without-uid-b',
      userName: 'Bob',
    });

    assert.notEqual(second.id, first.id);
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      2,
    );
  } finally {
    service.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('separate combo batches keep their timestamp in the buffer key', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-combo-batches-'),
  );
  const db = createDatabases({ dataDir });
  const state = { giftComboPending: new Map(), blindBoxCache: null };
  const service = createGiftService({
    db,
    state,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
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
        messageTimestamp: Date.now(),
      });
    }

    assert.equal(
      db.giftDb
        .prepare(
          "SELECT COUNT(*) AS count FROM gift_events WHERE detection_status = 'progress'",
        )
        .get().count,
      2,
    );
    service.dispose();
    assert.equal(
      db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get()
        .count,
      2,
    );
    assert.equal(
      db.giftDb
        .prepare(
          "SELECT COUNT(*) AS count FROM gift_events WHERE detection_status = 'final'",
        )
        .get().count,
      2,
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
        uname: 'Alice',
      },
    });

    assert.equal(gift.coinType, coinType);
    assert.equal(gift.totalPrice, 0);
    assert.equal(gift.comboTotalPrice, 0);
  }
});
