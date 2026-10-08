'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSceneGiftEvents } = require('../../src/server/scene-gift-events');
const { createSceneGiftDisplay } = require('../../public/js/overlays/scene-gift-display.js');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');

const frame = (id) => ({ type: 'gift:frame', eventId: `frame:${id}`, userName: '观众', giftName: '小花花',
  num: 1, totalPriceCents: 2000, themeId: 'woodland-bloom', avatarUrl: 'https://i0.hdslb.com/bfs/face/viewer.webp' });
const thanks = { type: 'gift:guard-thanks', eventId: 'guard:1', userName: '舰长', tier: 'captain', months: 1, textMode: 'zh' };

test('both enabled guard styles survive scene event deduplication for one purchase', () => {
  const { buildGuardThanksEvents } = require('../../src/bilibili/gift/guard-thanks-config');
  const buffer = createSceneGiftEvents({ getOwner: () => ({ scope: 'a', epoch: 1 }) });
  const events = buildGuardThanksEvents({ id: 1, gift_id: 'guard-3' }, {
    guardThanksAuroraEnabled: 'true', guardThanksAuroraTextMode: 'zh',
    guardThanksClassicEnabled: 'true', guardThanksClassicTextMode: 'en',
  });
  for (const event of events) { assert.equal(buffer.receive(event), true); assert.equal(buffer.receive(event), false); }
  assert.deepEqual(buffer.getSnapshot('guard-thanks').events.map(({ payload }) => [payload.style, payload.textMode]),
    [['aurora', 'zh'], ['classic', 'en']]);
});

test('scene gift window isolates types and owners, projects fields, deduplicates and stays bounded', () => {
  let owner = { scope: 'a', epoch: 1 };
  const buffer = createSceneGiftEvents({ getOwner: () => owner });
  buffer.receive({ ...frame(1), token: 'private', uid: 'private' });
  assert.equal(buffer.receive(frame(1)), false);
  buffer.receive(thanks);
  assert.deepEqual(buffer.getSnapshot('gift-frame').events.map(({ payload }) => payload), [frame(1)]);
  assert.deepEqual(buffer.getSnapshot('guard-thanks').events.map(({ payload }) => payload), [thanks]);
  assert.equal(buffer.receive({ type: 'gift:effect' }), false);
  const initial = buffer.getSnapshot('gift-frame');
  initial.events[0].payload.userName = 'mutated';
  assert.equal(buffer.getSnapshot('gift-frame').events[0].payload.userName, '观众');
  for (let i = 2; i < 205; i++) buffer.receive(frame(i));
  assert.equal(buffer.getSnapshot('gift-frame').events.length, 200);
  owner.epoch++;
  assert.deepEqual(buffer.getSnapshot('gift-frame').events, []);
  assert.notEqual(buffer.getSnapshot('gift-frame').epoch, initial.epoch);
  buffer.receive(frame(1));
  owner = { scope: 'b', epoch: 2 };
  assert.deepEqual(buffer.getSnapshot('gift-frame').events, []);
  owner = null;
  assert.equal(buffer.receive(frame(2)), false);
});

test('scene parent starts at current events, buffers preparation and never replays consumed or disconnected events', () => {
  const buffer = createSceneGiftEvents({ getOwner: () => ({ scope: 'a', epoch: 1 }) });
  const display = createSceneGiftDisplay();
  const read = (types = []) => display.update({ 'gift-frame': buffer.getSnapshot('gift-frame'),
    'guard-thanks': buffer.getSnapshot('guard-thanks') }, types);
  buffer.receive(frame('before-open'));
  assert.deepEqual(read()['gift-frame'].events, []);
  buffer.receive(frame(1)); buffer.receive(thanks);
  read(); read();
  assert.deepEqual(display.takePending()['gift-frame'].events, [frame(1)]);
  assert.deepEqual(display.takePending(), {});
  const active = ['gift-frame', 'guard-thanks'];
  buffer.receive(frame(2));
  assert.deepEqual(read(active)['gift-frame'].events, [frame(2)]);
  assert.deepEqual(read(active)['gift-frame'].events, []);
  assert.deepEqual(display.takePending(), {});
  display.clear();
  buffer.receive(frame('offline'));
  assert.deepEqual(read(active)['gift-frame'].events, []);
  buffer.receive(frame(3));
  assert.deepEqual(read(active)['gift-frame'].events, [frame(3)]);
  display.update({}, []);
  buffer.receive(frame('while-removed'));
  assert.deepEqual(read()['gift-frame'].events, [], 'adding a removed type starts at its current sequence');
});

test('final gift ingress reuses existing eligibility for both scene types without another business consumer', () => {
  const received = [];
  let settings = { giftFrameEnabled: 'true', giftFrameThresholdRmb: '20', guardThanksEnabled: 'true' };
  const transport = createRuntimeTransport({ defaultPort: 3000, getHost: () => '127.0.0.1', getStartedPort: () => 3000,
    getSessionToken: () => 'synthetic', getState: () => ({}), getSettings: () => settings,
    getDanmakuFeedBuffer: () => ({ pushGift: () => null }), getWebSocketHub: () => null,
    publishSceneGift: (event) => received.push(event) });
  const row = { id: 1, gift_id: 'guard-3', gift_name: '舰长', user_name: '观众', num: 1,
    total_price: 198000, coin_type: 'gold', detection_status: 'final' };
  transport.publishGiftFlushed(row);
  assert.deepEqual(received.map((event) => event.type), ['gift:frame', 'gift:guard-thanks', 'gift:guard-thanks']);
  assert.equal(received.at(-1).style, 'nautical');
  settings = { giftFrameEnabled: 'false', guardThanksEnabled: 'false' };
  transport.publishGiftFlushed({ ...row, id: 2 });
  assert.equal(received.length, 3);
});
