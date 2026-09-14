'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGiftEffectEvent } = require('../src/bilibili/gift/effect-event');
const { handleGiftEventBlock } = require('../src/electron/license/remote-license-client');
const { createRuntimeTransport } = require('../src/server/runtime-transport');
const { createRemoteGiftController } = require('../src/electron/remote-gift-controller');
const { createFixture } = require('./helpers/remote-gift-controller-fixture');
const { createGiftEffectResolver } = require('../src/bilibili/gift/effect-config');
const { routes } = require('../src/server/routes/gift-routes');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-defaults');
const { normalizeSettingsPatch, normalizeCloudSettingsSnapshot, serializeCloudSettings, hasCloudSettingChanges } = require('../src/server/settings-contract');

function effectEvent() {
  return {
    type: 'gift:effect', source: 'danmaku',
    eventId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    giftId: '32132',
  };
}

test('effect command projection accepts only a numeric code and drops supplied media and private fields', () => {
  const event = effectEvent();
  assert.deepEqual(normalizeGiftEffectEvent({
    ...event, uid: 'private', token: 'secret', giftName: '浪漫城堡',
    effect: { mp4Url: 'https://untrusted.test/injected.mp4' },
  }), event);
  assert.equal(normalizeGiftEffectEvent({ ...event, eventId: '-'.repeat(36) }), null);
  for (const giftId of ['浪漫城堡', '0', '-1', '32132 城堡', '1234567890123', 32132]) {
    assert.equal(normalizeGiftEffectEvent({ ...event, giftId }), null);
  }
});

test('gift-effect SSE never enters processed gift recovery and malformed frames are isolated', () => {
  const seen = [];
  const event = effectEvent();
  const processGift = () => assert.fail('effect entered gift ledger path');
  handleGiftEventBlock(`event: gift-effect\ndata: ${JSON.stringify(event)}`, processGift, value => seen.push(value));
  handleGiftEventBlock('event: gift-effect\ndata: {bad', processGift, value => seen.push(value));
  assert.deepEqual(seen, [event]);
});

test('effect toggle is disabled by default, cloud-synced, validated and defaults off for old snapshots', () => {
  assert.equal(DEFAULT_SETTINGS.giftEffectDanmakuEnabled, 'false');
  assert.equal(hasCloudSettingChanges(['giftEffectDanmakuEnabled']), true);
  const local = { ...DEFAULT_SETTINGS, giftEffectDanmakuEnabled: 'true' };
  const cloud = serializeCloudSettings(local);
  assert.equal(cloud.giftEffectDanmakuEnabled, true);
  assert.equal(normalizeCloudSettingsSnapshot(cloud).giftEffectDanmakuEnabled, 'true');
  delete cloud.giftEffectDanmakuEnabled;
  assert.equal(normalizeCloudSettingsSnapshot(cloud).giftEffectDanmakuEnabled, 'false');
  assert.ok(normalizeSettingsPatch({ giftEffectDanmakuEnabled: 'invalid' }, DEFAULT_SETTINGS).error);
});

test('danmaku resolves the same code and effect as test playback, including multiple bound effects', async () => {
  const events = [];
  let enabled = false;
  const resolver = createGiftEffectResolver({
    fetchJson: async () => ({ payload: { data: { full_sc_resource: { conf_list: [806, 807].map(id => ({
      id, bind_gift_ids: [32132],
      web_mp4: `https://i0.hdslb.com/${id}.mp4`,
      web_mp4_json: `https://i0.hdslb.com/${id}.json`,
    })) } } } }),
    fetchLayoutJson: async () => ({ payload: { info: {
      videoW: 4, videoH: 2, rgbFrame: [0, 0, 2, 2], aFrame: [2, 0, 2, 2],
    } } }),
  });
  const resolveEffect = giftId => resolver.resolveEffect(giftId);
  const runtime = createRuntimeTransport({
    getSettings: () => ({ giftEffectDanmakuEnabled: String(enabled) }),
    getWebSocketHub: () => ({ broadcast: value => events.push(value) }),
    resolveGiftEffect: resolveEffect,
  });
  assert.equal(await runtime.publishGiftEffect(effectEvent(), () => true), false);
  enabled = true;
  assert.equal(await runtime.publishGiftEffect(effectEvent(), () => true), true);
  await routes['POST /api/gifts/effects/preview']({
    gifts: { resolveEffect, previewEffect: value => events.push(value) },
  }, { body: async () => ({ giftId: '32132' }) }, {
    writeHead: status => assert.equal(status, 200),
    end: content => assert.equal(JSON.parse(content).ok, true),
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].giftId, events[1].giftId);
  assert.deepEqual(events[0].effect, events[1].effect);
  assert.equal(events[0].effect.effectId, 807);
  assert.equal(await runtime.publishGiftEffect({ ...effectEvent(), giftId: '1' }, () => true), false);
  enabled = false;
  assert.equal(await runtime.publishGiftEffect(effectEvent(), () => true), false);
  assert.equal(events.length, 2);
});

test('effect lookup failure does not publish or reject the stream callback', async () => {
  const runtime = createRuntimeTransport({
    getSettings: () => ({ giftEffectDanmakuEnabled: 'true' }),
    getWebSocketHub: () => ({ broadcast: () => assert.fail('failed lookup was played') }),
    resolveGiftEffect: async () => { throw new Error('lookup failed'); },
  });
  assert.equal(await runtime.publishGiftEffect(effectEvent(), () => true), false);
});

test('lookup results after disable, stream stop or authorization change cannot play', async () => {
  for (const change of ['disable', 'stop', 'authorization']) {
    const fixture = createFixture();
    let enabled = true;
    let finishLookup;
    let pending;
    const runtime = createRuntimeTransport({
      getSettings: () => ({ giftEffectDanmakuEnabled: String(enabled) }),
      getWebSocketHub: () => ({ broadcast: () => assert.fail(`late ${change} effect was played`) }),
      resolveGiftEffect: () => new Promise(resolve => { finishLookup = resolve; }),
    });
    fixture.options.runtime.publishGiftEffect = (...args) => { pending = runtime.publishGiftEffect(...args); };
    const controller = createRemoteGiftController(fixture.options);
    try {
      await controller.start();
      await controller.whenIdle();
      fixture.stream.onEffect(effectEvent());
      assert.equal(typeof finishLookup, 'function');
      if (change === 'disable') enabled = false;
      if (change === 'stop') controller.stop();
      if (change === 'authorization') fixture.authorization.epoch++;
      finishLookup({ effectId: 806 });
      assert.equal(await pending, false);
    } finally { controller.dispose(); }
  }
});

test('remote effects share the current authorization fence and stopped streams cannot publish', async () => {
  const fixture = createFixture();
  const events = [];
  fixture.options.runtime.publishGiftEffect = value => events.push(value);
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  await controller.whenIdle();
  const stream = fixture.stream;
  stream.onEffect(effectEvent());
  assert.equal(events.length, 1);
  controller.stop();
  stream.onEffect(effectEvent());
  assert.equal(events.length, 1);
  controller.dispose();
});

test('completed SSE and changed authorization reject late effect callbacks', async () => {
  for (const closeStreamImmediately of [false, true]) {
    const fixture = createFixture({ closeStreamImmediately });
    const events = [];
    fixture.options.runtime.publishGiftEffect = event => events.push(event);
    const controller = createRemoteGiftController(fixture.options);
    await controller.start();
    await controller.whenIdle();
    await new Promise(resolve => setImmediate(resolve));
    if (!closeStreamImmediately) fixture.authorization.epoch++;
    fixture.stream.onEffect(effectEvent());
    assert.equal(events.length, 0);
    controller.dispose();
  }
});
