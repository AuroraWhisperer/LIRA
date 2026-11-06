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
    giftDropDurationSeconds: '12', giftDropSpeed: '75', giftDropBounce: '60',
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
  const both = buildGiftMotionEvents({ ...gift, total_price: 10 }, settings);
  assert.deepEqual(both.map(event => event.themeId), ['gift-drop', 'gift-swing']);
  assert.notEqual(both[0].eventId, both[1].eventId);
  assert.equal(both[1].motion.speed, 150);
  assert.equal(both[1].motion.textMode, 'gift');
  assert.equal(buildGiftMotionEvents({ ...gift, detection_status: 'progress' }, settings).length, 0);
  assert.equal(buildGiftMotionEvents({ ...gift, total_price: 0 }, settings).length, 0);
  assert.equal(normalizeGiftMotionSetting('giftDropSize', 0), null);
  assert.equal(normalizeGiftMotionSetting('giftSwingAngle', 100), null);
  assert.equal(normalizeGiftMotionSetting('giftSwingTextMode', 'unknown'), null);
});

test('late arrival and image preparation never restart a drop lifetime', () => {
  const world = createGiftDropWorld({ random: () => 0.5 });
  const event = { eventId: 'a', num: 3, startedAt: 1000, motion: { size: 80, durationSeconds: 3 } };
  world.addGift(event, 2500);
  assert.equal(world.bodies.length, 3);
  assert.equal(world.bodies[0].expiresAt, 4000);
  world.step(0, 4000);
  assert.equal(world.bodies.length, 0);
  world.addGift({ ...event, eventId: 'late' }, 5000);
  assert.equal(world.bodies.length, 0);
});

test('expired support disappears first and the supported drop falls to the floor', () => {
  const world = createGiftDropWorld({ width: 500, height: 500, random: () => 0.5 });
  world.addGift({ eventId: 'bottom', num: 1, startedAt: 1000, motion: { size: 80, durationSeconds: 3 } }, 1000);
  world.addGift({ eventId: 'top', num: 1, startedAt: 2000, motion: { size: 80, durationSeconds: 3 } }, 2000);
  const [bottom, top] = world.bodies;
  Object.assign(bottom, { x: 250, y: 460, angle: 0, vx: 0, vy: 0, spin: 0 });
  Object.assign(top, { x: 250, y: 380, angle: 0, vx: 0, vy: 0, spin: 0 });
  for (let index = 0; index < 60; index++) world.step(1 / 60, 3000 + index * 10);
  assert.ok(top.y < 390, `supported at ${top.y}`);
  world.step(1 / 60, 4000);
  assert.equal(world.bodies.includes(bottom), false);
  for (let index = 0; index < 45; index++) world.step(1 / 60, 4010 + index * 10);
  assert.ok(top.y > 450, `fell to ${top.y}`);
  assert.equal(top.expiresAt, 5000);
  world.step(0, 5000);
  assert.equal(world.bodies.length, 0);
});
