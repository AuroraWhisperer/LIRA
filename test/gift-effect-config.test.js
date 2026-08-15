'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  EFFECT_API_URL,
  buildEffectMap,
  buildGiftEffectEvent,
  createGiftEffectResolver,
  isTrustedEffectUrl,
  parseEffectLayout,
  pickEffect
} = require('../src/bilibili/gift/effect-config');
const { createGiftDetectionService } = require('../src/bilibili/gift');
const { closeDatabases, createDatabases } = require('../src/storage/database');

function confEntry(id, giftIds, mp4Url = `https://i0.hdslb.com/bfs/live/effect-${id}.mp4`) {
  return {
    id,
    type: 1,
    bind_gift_ids: giftIds,
    web_mp4: mp4Url,
    web_mp4_json: `https://i0.hdslb.com/bfs/live/effect-${id}.json`,
    web_mp4_md5: `md5-${id}`,
    web_mp4_file_size: 1000 + id
  };
}

function packedLayout() {
  return {
    info: {
      videoW: 1088,
      videoH: 1296,
      rgbFrame: [0, 0, 720, 1280],
      aFrame: [724, 0, 360, 640],
      fps: 30,
      f: 270
    }
  };
}

test('buildEffectMap maps gift ids to the newest trusted MP4 effect', () => {
  const untrustedLayout = confEntry(2001, [99998]);
  untrustedLayout.web_mp4_json = 'https://example.com/effect.json';
  const payload = {
    data: {
      full_sc_resource: {
        conf_list: [
          confEntry(8, [25], ''),
          confEntry(584, [31645]),
          confEntry(147, [30636]),
          confEntry(1638, [30636]),
          confEntry(2000, [99999], 'https://example.com/effect.mp4'),
          untrustedLayout,
          confEntry(1, [0])
        ]
      }
    }
  };

  const map = buildEffectMap(payload);

  assert.equal(map.size, 2);
  assert.equal(map.get(31645).effectId, 584);
  assert.equal(map.get(31645).fileSize, 1584);
  assert.equal(map.get(31645).layoutUrl, 'https://i0.hdslb.com/bfs/live/effect-584.json');
  assert.equal(map.get(30636).effectId, 1638);
  assert.equal(map.get(25), undefined);
  assert.equal(map.get(99999), undefined);
  assert.equal(map.get(99998), undefined);
});

test('effect helpers tolerate missing entries and reject untrusted URLs', () => {
  assert.equal(buildEffectMap(null).size, 0);
  assert.equal(buildEffectMap({ data: {} }).size, 0);
  assert.equal(pickEffect([confEntry(2, [1]), confEntry(9, [1])]).id, 9);
  assert.equal(pickEffect([]), null);
  assert.equal(isTrustedEffectUrl('https://i0.hdslb.com/bfs/live/a.mp4'), true);
  assert.equal(isTrustedEffectUrl('http://i0.hdslb.com/bfs/live/a.mp4'), false);
  assert.equal(isTrustedEffectUrl('https://hdslb.com.example.com/a.mp4'), false);
});

test('parseEffectLayout keeps the official RGB and alpha rectangles and rejects invalid bounds', () => {
  assert.deepEqual(parseEffectLayout(packedLayout()), {
    videoWidth: 1088,
    videoHeight: 1296,
    rgbFrame: [0, 0, 720, 1280],
    alphaFrame: [724, 0, 360, 640]
  });
  assert.throws(() => parseEffectLayout({
    info: {
      ...packedLayout().info,
      rgbFrame: [0, 0, 1089, 1296]
    }
  }), /\u5750\u6807/);
  assert.throws(() => parseEffectLayout({
    info: {
      ...packedLayout().info,
      aFrame: [724, 0, 0, 640]
    }
  }), /\u5750\u6807/);

  assert.deepEqual(parseEffectLayout({
    info: {
      videoW: 1088,
      videoH: 368,
      rgbFrame: [0, 0, 1080, 240],
      aFrame: [0, 244, 540, 120]
    }
  }), {
    videoWidth: 1088,
    videoHeight: 368,
    rgbFrame: [0, 0, 1080, 240],
    alphaFrame: [0, 244, 540, 120]
  });
  assert.deepEqual(parseEffectLayout({
    info: {
      videoW: 464,
      videoH: 592,
      rgbFrame: [0, 0, 300, 579],
      aFrame: [304, 0, 150, 289]
    }
  }).rgbFrame, [0, 0, 300, 579]);
});

test('resolver fetches lazily, dedupes concurrent calls and refreshes after ttl', async () => {
  let calls = 0;
  let nowMs = 1000;
  const resolver = createGiftEffectResolver({
    refreshMs: 100,
    now: () => nowMs,
    fetchJson: async (name, url) => {
      calls += 1;
      assert.equal(name, 'gift_effect_config');
      assert.equal(url, EFFECT_API_URL);
      return {
        payload: {
          data: { full_sc_resource: { conf_list: [confEntry(584 + calls, [31645])] } }
        }
      };
    }
  });

  assert.equal(resolver.resolve(31645), null);
  const [first, same] = await Promise.all([resolver.getEffectMap(), resolver.getEffectMap()]);
  assert.equal(calls, 1);
  assert.equal(first, same);
  assert.equal(resolver.resolve(31645).effectId, 585);

  nowMs += 99;
  await resolver.getEffectMap();
  assert.equal(calls, 1);

  nowMs += 1;
  await resolver.getEffectMap();
  assert.equal(calls, 2);
  assert.equal(resolver.resolve(31645).effectId, 586);
});

test('resolver keeps stale cache when refresh fails', async () => {
  let calls = 0;
  let nowMs = 1000;
  const resolver = createGiftEffectResolver({
    refreshMs: 10,
    retryMs: 50,
    now: () => nowMs,
    fetchJson: async () => {
      calls += 1;
      if (calls > 1) throw new Error('network down');
      return {
        payload: {
          data: { full_sc_resource: { conf_list: [confEntry(584, [31645])] } }
        }
      };
    }
  });

  await resolver.getEffectMap();
  nowMs += 10;
  const stale = await resolver.getEffectMap();
  assert.equal(stale.get(31645).effectId, 584);

  nowMs += 10;
  await resolver.getEffectMap();
  assert.equal(calls, 2, 'failed refreshes should be throttled');
});

test('resolver fetches and dedupes packed-alpha layout metadata lazily', async () => {
  let catalogCalls = 0;
  let layoutCalls = 0;
  const resolver = createGiftEffectResolver({
    fetchJson: async () => {
      catalogCalls += 1;
      return {
        payload: {
          data: { full_sc_resource: { conf_list: [confEntry(806, [32132])] } }
        }
      };
    },
    fetchLayoutJson: async (name, url) => {
      layoutCalls += 1;
      assert.equal(name, 'gift_effect_layout');
      assert.equal(url, 'https://i0.hdslb.com/bfs/live/effect-806.json');
      return { payload: packedLayout() };
    }
  });

  const [first, same] = await Promise.all([
    resolver.resolveEffect(32132),
    resolver.resolveEffect(32132)
  ]);

  assert.equal(catalogCalls, 1);
  assert.equal(layoutCalls, 1);
  assert.deepEqual(first, same);
  assert.deepEqual(first.layout, {
    videoWidth: 1088,
    videoHeight: 1296,
    rgbFrame: [0, 0, 720, 1280],
    alphaFrame: [724, 0, 360, 640]
  });

  await resolver.resolveEffect(32132);
  assert.equal(layoutCalls, 1);
});

test('resolver throttles failed layout requests and retries after the retry window', async () => {
  let nowMs = 1000;
  let layoutCalls = 0;
  const resolver = createGiftEffectResolver({
    retryMs: 50,
    now: () => nowMs,
    fetchJson: async () => ({
      payload: {
        data: { full_sc_resource: { conf_list: [confEntry(806, [32132])] } }
      }
    }),
    fetchLayoutJson: async () => {
      layoutCalls += 1;
      if (layoutCalls === 1) throw new Error('layout network down');
      return { payload: packedLayout() };
    }
  });

  const [first, sameFailure] = await Promise.all([
    resolver.resolveEffect(32132),
    resolver.resolveEffect(32132)
  ]);
  assert.equal(first, null);
  assert.equal(sameFailure, null);
  assert.equal(layoutCalls, 1);

  nowMs += 49;
  assert.equal(await resolver.resolveEffect(32132), null);
  assert.equal(layoutCalls, 1);

  nowMs += 1;
  assert.equal((await resolver.resolveEffect(32132)).effectId, 806);
  assert.equal(layoutCalls, 2);
});

test('buildGiftEffectEvent supports normalized database rows and camelCase inputs', async () => {
  const effect = {
    effectId: 584,
    type: 1,
    mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
    md5: '',
    fileSize: 417612
  };
  const resolver = {
    getEffectMap: async () => new Map([[35457, effect]])
  };

  const fromRow = await buildGiftEffectEvent({
    id: 77,
    gift_id: '35457',
    gift_name: '马上来财',
    num: 2,
    unit_price: 10,
    user_name: '观众A'
  }, resolver);
  assert.deepEqual(fromRow, {
    type: 'gift:effect',
    eventId: 77,
    giftId: 35457,
    giftName: '马上来财',
    num: 2,
    unitPrice: 10,
    userName: '观众A',
    effect
  });

  const fromCamelCase = await buildGiftEffectEvent({ id: 78, giftId: 35457 }, resolver);
  assert.equal(fromCamelCase.giftName, '礼物');
  assert.equal(await buildGiftEffectEvent({ id: 79, gift_id: '0' }, resolver), null);
  assert.equal(await buildGiftEffectEvent({ id: 80, gift_id: '31643' }, resolver), null);
});

test('gift effect capture stays active when sprint and overtime consumers are disabled', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gift-effect-capture-'));
  const db = createDatabases({ dataDir });
  const finalized = [];
  const detection = createGiftDetectionService({
    db,
    settings: () => ({ enableGiftSprint: 'false', giftBlindBoxConfig: '' }),
    state: { blindBoxCache: null }
  }, {
    captureWhenDisabled: true,
    onGiftFinalized: (row) => finalized.push(row)
  });

  try {
    const row = detection.detect({
      cmd: 'SEND_GIFT',
      giftId: '31645',
      giftName: '测试礼物',
      uid: '42',
      userName: '观众A',
      num: 1,
      unitPrice: 1,
      totalPrice: 1
    });

    assert.equal(row.detection_status, 'final');
    assert.equal(finalized.length, 1);
    assert.equal(detection.getStatus().consumers.giftEffects, true);
  } finally {
    detection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
