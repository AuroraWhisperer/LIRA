'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildGiftMotionEvents, normalizeGiftMotionSetting } = require('../../src/bilibili/gift/motion-config');
const { createGiftDropWorld } = require('../../public/js/shared/gift-drop-physics.js');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');
const { createSceneGiftEvents } = require('../../src/server/scene-gift-events');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');

test('settlement publication resolves exact artwork once and both scoped styles survive delivery deduplication', () => {
  const buffer = createSceneGiftEvents({ getOwner: () => ({ scope: 'synthetic', epoch: 1 }) });
  const settings = { giftDropEnabled: 'true', giftDropSpeed: '75', giftDropBounce: '60', giftSwingEnabled: 'true' };
  let resolved = 0;
  const transport = createRuntimeTransport({
    defaultPort: 3000, getHost: () => '127.0.0.1', getStartedPort: () => 3000,
    getSessionToken: () => 'synthetic', getState: () => ({}), getSettings: () => settings,
    getDanmakuFeedBuffer: () => ({ pushGift: () => null }), getWebSocketHub: () => null,
    resolveGiftMotionArtwork: item => { resolved++; assert.equal(item.gift_variant_id, 'variant-a'); return '/overtime-gift-images/variant-a.webp'; },
    publishSceneGift: buffer.receive,
  });
  const row = { id: 1, detection_status: 'final', total_price: 5, num: 2, gift_variant_id: 'variant-a' };
  const before = Date.now();
  transport.publishGiftFlushed(row);
  const events = buffer.getSnapshot('gift-frame').events.map(event => event.payload);
  assert.equal(resolved, 1);
  assert.equal(events.length, 2);
  assert.equal(events[0].artworkPath, '/overtime-gift-images/variant-a.webp');
  assert.equal(events[0].startedAt, events[1].startedAt);
  assert.ok(events[0].startedAt >= before && events[0].startedAt <= Date.now());
  assert.equal(events[0].motion.durationSeconds, 20);
  assert.equal(events[0].motion.speed, 75);
  assert.equal(events[0].motion.bounce, 60);
  transport.publishGiftFlushed(row);
  assert.equal(buffer.getSnapshot('gift-frame').events.length, 2);
});

test('each motion effect independently accepts final total and captures its own parameters at settlement', () => {
  const { values: settings, error } = normalizeSettingsPatch({ giftDropEnabled: 'true', giftDropThresholdRmb: '5', giftDropSize: '72',
    giftDropDurationSeconds: '12', giftDropSpeed: '75', giftDropBounce: '60', giftDropQuantityMultiplier: '3',
    giftSwingEnabled: 'true', giftSwingThresholdRmb: '10', giftSwingSpeed: '150', giftSwingTextMode: 'gift' }, DEFAULT_SETTINGS);
  assert.equal(error, undefined);
  const gift = { id: 8, detection_status: 'final', total_price: 5, num: 99, gift_name: '小花花' };
  const [drop] = buildGiftMotionEvents(gift, settings, { startedAt: 1234 });
  assert.equal(drop.themeId, 'gift-drop');
  assert.equal(drop.startedAt, 1234);
  assert.equal(drop.motion.size, 72);
  assert.equal(drop.motion.durationSeconds, 12);
  assert.equal(drop.motion.speed, 75);
  assert.equal(drop.motion.bounce, 60);
  assert.equal(drop.motion.quantityMultiplier, 3);
  assert.equal(drop.num, 99);
  const both = buildGiftMotionEvents({ ...gift, total_price: 10 }, settings);
  assert.deepEqual(both.map(event => event.themeId), ['gift-drop', 'gift-swing']);
  assert.notEqual(both[0].eventId, both[1].eventId);
  assert.equal(both[1].motion.speed, 150);
  assert.equal(both[1].motion.textMode, 'gift');
  assert.equal(buildGiftMotionEvents({ ...gift, detection_status: 'progress' }, settings).length, 0);
  assert.equal(buildGiftMotionEvents({ ...gift, total_price: 0 }, settings).length, 0);
  assert.equal(normalizeGiftMotionSetting('giftDropSize', 0), null);
  assert.ok(normalizeSettingsPatch({ giftDropQuantityMultiplier: '9' }, DEFAULT_SETTINGS).error);
  assert.equal(normalizeGiftMotionSetting('giftDropQuantityMultiplier', 1.5), null);
  assert.equal(normalizeGiftMotionSetting('giftSwingAngle', 100), null);
  assert.equal(normalizeGiftMotionSetting('giftSwingTextMode', 'unknown'), null);
});

test('drop quantity defaults to four visual copies per gift and accepts a saved multiplier without changing the receipt', () => {
  const gift = { id: 9, detection_status: 'final', total_price: 5, num: 3 };
  const settings = { giftDropEnabled: 'true' };
  const world = createGiftDropWorld({ random: () => 0.5 });
  const [event] = buildGiftMotionEvents(gift, settings, { startedAt: 1000 });
  assert.equal(world.addGift(event, 1000).length, 12);
  assert.equal(event.num, 3);
  const [adjusted] = buildGiftMotionEvents({ ...gift, id: 10 }, { ...settings, giftDropQuantityMultiplier: '2' }, { startedAt: 1000 });
  assert.equal(world.addGift(adjusted, 1000).length, 6);
  assert.equal(adjusted.num, 3);
});

test('independent swing text choices survive settlement without overwriting saved motion values', () => {
  const { values: settings, error } = normalizeSettingsPatch({ giftSwingEnabled: 'true',
    giftSwingTextMode: 'name-quantity', giftSwingSpeed: '100', giftSwingAngle: '24' }, DEFAULT_SETTINGS);
  assert.equal(error, undefined);
  const [event] = buildGiftMotionEvents({ id: 11, detection_status: 'final', total_price: 1, num: 4 }, settings);
  assert.equal(event.motion.textMode, 'name-quantity');
  assert.equal(event.motion.speed, 100);
  assert.equal(event.motion.angle, 24);
});

test('amplified large combos retain their true remainder and never evict existing drops at capacity', () => {
  const world = createGiftDropWorld({ random: () => 0.5 });
  const event = { eventId: 'combo', num: 100, startedAt: 1000,
    motion: { size: 80, durationSeconds: 20, quantityMultiplier: 2 } };
  const added = world.addGift(event, 1000);
  assert.equal(added.length, 120);
  assert.equal(added.at(-1).quantity, 41);
  const next = world.addGift({ ...event, eventId: 'next', motion: { ...event.motion, quantityMultiplier: 8 } }, 1000);
  assert.equal(next.length, 280);
  assert.ok(added.every(body => world.bodies.includes(body)));
  assert.equal(world.addGift({ ...event, eventId: 'full' }, 1000).length, 0);
});

test('staggered drops expire independently and late arrival never restarts their lifetime', () => {
  let roll = 0;
  const world = createGiftDropWorld({ random: () => (roll++ % 10) / 10 });
  const event = { eventId: 'a', num: 3, startedAt: 1000, motion: { size: 80, durationSeconds: 3, quantityMultiplier: 1 } };
  world.addGift(event, 2500);
  assert.equal(world.bodies.length, 3);
  const deadlines = world.bodies.map(body => body.expiresAt);
  assert.ok(deadlines.every(deadline => deadline >= 4000 && deadline < 5000));
  world.step(0, Math.min(...deadlines));
  assert.ok(world.bodies.length > 0 && world.bodies.length < 3);
  world.step(0, Math.max(...deadlines));
  assert.equal(world.bodies.length, 0);
  world.addGift({ ...event, eventId: 'late' }, 5000);
  assert.equal(world.bodies.length, 0);
});

test('expired support disappears first and the supported drop falls to the floor', () => {
  const world = createGiftDropWorld({ width: 500, height: 500, random: () => 0.5 });
  world.addGift({ eventId: 'bottom', num: 1, startedAt: 1000, motion: { size: 80, durationSeconds: 3, quantityMultiplier: 1 } }, 1000);
  world.addGift({ eventId: 'top', num: 1, startedAt: 2000, motion: { size: 80, durationSeconds: 3, quantityMultiplier: 1 } }, 2000);
  const [bottom, top] = world.bodies;
  const floorY = 500 - bottom.half; const supportedY = floorY - bottom.half - top.half;
  Object.assign(bottom, { x: 250, y: floorY, angle: 0, vx: 0, vy: 0, spin: 0 });
  Object.assign(top, { x: 250, y: supportedY, angle: 0, vx: 0, vy: 0, spin: 0 });
  for (let index = 0; index < 60; index++) world.step(1 / 60, 3000 + index * 10);
  assert.ok(top.y < supportedY + 10, `supported at ${top.y}`);
  world.step(1 / 60, bottom.expiresAt);
  assert.equal(world.bodies.includes(bottom), false);
  for (let index = 0; index < 45; index++) world.step(1 / 60, bottom.expiresAt + 10 + index * 10);
  assert.ok(top.y > floorY - 10, `fell to ${top.y}`);
  world.step(0, top.expiresAt);
  assert.equal(world.bodies.length, 0);
});
