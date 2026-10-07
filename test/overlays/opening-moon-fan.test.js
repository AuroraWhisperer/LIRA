'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const artPath = path.join(__dirname, '../../public/js/overlays/opening-moon-fan-art.js');
const runtimePath = path.join(__dirname, '../../public/js/overlays/opening-moon-fan.js');

test('fan sectors share one closed direction and retain contiguous artwork when open', async () => {
  const { FAN_SLICES, fanSlicePose } = await loadModuleExports(artPath);
  let previous;
  for (let index = 0; index < FAN_SLICES; index += 1) {
    const closed = fanSlicePose(index, 0);
    const open = fanSlicePose(index, 1);
    assert.ok(Math.abs((closed.start + closed.end) / 2 + closed.rotation + Math.PI / 2) < 1e-12);
    assert.equal(Math.abs(open.rotation), 0);
    assert.ok(open.end > open.start);
    if (previous) assert.equal(open.start, previous.end);
    previous = open;
  }
});

test('every act opens, holds, fades its copy, folds away and leaves the garden before reopening', async () => {
  const { LOOP_SECONDS, moonFanFrame } = await loadModuleExports(artPath);
  const visible = ['scenery', 'flowers', 'fan', 'ribbon', 'lettering', 'detail'];
  const times = Array.from({ length: Math.round(LOOP_SECONDS * 20) }, (_, index) => index / 20);
  const frames = times.map(time => ({ time, ...moonFanFrame(time) }));
  const hold = frames.findIndex(frame => visible.every(key => frame[key] === 1));
  assert.ok(hold > 0, 'the fan opens before a fully visible hold');
  assert.ok(frames[0].fan < 1 && frames[0].lettering === 0, 'each act starts closed without copy');
  const held = frames.filter(frame => visible.every(key => frame[key] === 1));
  assert.ok(held.some(frame => frame.bird === 0), 'the bird passes only briefly during the hold');
  const closing = frames.findIndex((frame, index) => index > hold && frame.fan < 1);
  assert.ok(closing > hold, 'the fan folds after the hold');
  assert.ok(frames[closing].lettering < 1, 'copy fades before the fan folds');
  const folded = frames.slice(closing);
  assert.ok(folded.every((frame, index) => !index || frame.fan <= folded[index - 1].fan), 'folding never reopens');
  assert.ok(folded.some(frame => frame.fan > 0 && frame.fan < 1 && frame.fanOpacity > 0.95), 'folding remains visible before its fade');
  const interval = folded.filter(frame => frame.fanOpacity === 0);
  assert.ok(interval.length > 0, 'the garden is shown alone before reopening');
  for (const frame of [...interval, { time: LOOP_SECONDS, ...moonFanFrame(LOOP_SECONDS) }]) {
    assert.equal(frame.scenery, 1, `the interval must never flash to an empty background at ${frame.time}s`);
    for (const key of ['fanOpacity', 'lettering', 'detail', 'ribbon', 'flowers', 'bird']) {
      assert.equal(frame[key], 0, `${key} has left at ${frame.time}s`);
    }
  }
  for (const time of times.filter((_, index) => index % 10 === 0)) {
    const once = moonFanFrame(time + LOOP_SECONDS);
    const twice = moonFanFrame(time + LOOP_SECONDS * 2);
    for (const key of Object.keys(once)) assert.equal(twice[key], once[key], `${key} repeats at ${time}s`);
  }
  for (const key of visible) assert.equal(moonFanFrame(0, true)[key], 1, 'reduced motion shows the complete still frame');
  assert.equal(moonFanFrame(99, true).phase, 0);
});

async function createHarness(decode = async () => {}) {
  const callbacks = new Map();
  const backgrounds = [];
  const messages = [];
  let requestId = 0;
  let imageCount = 0;
  const context = record => new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: text => ({ width: text.length * 20 }),
    drawImage(image, x) { if (record && image.src?.endsWith('/landscape.webp')) backgrounds.push(x); },
    fillText(text) { if (record) messages.push(text); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const ctx = context(true);
  const canvas = { width: 1920, height: 1080, dataset: {}, getContext: () => ctx, setAttribute() {} };
  const { createMoonFanOpening, ASSET_FILES } = await loadModuleExports(runtimePath, {
    Image: class {
      width = 1536;
      height = 1024;
      constructor() { imageCount += 1; }
      decode() { return decode(); }
    },
    document: { createElement: () => ({ getContext: () => context(false) }) },
    requestAnimationFrame: callback => { callbacks.set(++requestId, callback); return requestId; },
    cancelAnimationFrame: id => callbacks.delete(id),
  });
  return {
    runtime: createMoonFanOpening(canvas), canvas, callbacks, backgrounds, messages,
    expectedImages: Object.keys(ASSET_FILES).length,
    imageCount: () => imageCount,
    frame(time) {
      assert.equal(callbacks.size, 1);
      const [id, callback] = [...callbacks][0];
      callbacks.delete(id);
      callback(time);
    },
  };
}

const config = { active: true, quality: 'normal', title: '月渡花汀', subtitle: '', footer: '' };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('moon fan loads once, keeps one loop, preserves paused time and resets only when reactivated', async () => {
  const h = await createHarness();
  h.runtime.update(config);
  h.runtime.update(config);
  await flush();
  assert.equal(h.canvas.dataset.ready, 'true');
  assert.equal(h.imageCount(), h.expectedImages);
  h.frame(0);
  const first = h.backgrounds.at(-1);
  h.frame(7000);
  const paused = h.backgrounds.at(-1);
  assert.notEqual(paused, first);
  h.runtime.update({ ...config, paused: true });
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.backgrounds.at(-1), paused);
  h.runtime.update(config);
  h.frame(17000);
  assert.equal(h.backgrounds.at(-1), paused);
  h.frame(18000);
  assert.notEqual(h.backgrounds.at(-1), paused);
  h.runtime.update({ ...config, active: false });
  assert.equal(h.callbacks.size, 0);
  h.runtime.update(config);
  assert.equal(h.backgrounds.at(-1), first);
  assert.equal(h.imageCount(), h.expectedImages);
  h.runtime.update({ ...config, quality: 'low' });
  assert.equal(h.canvas.width, 1280);
  h.runtime.update({ ...config, reducedMotion: true });
  assert.equal(h.canvas.width, 1920);
  assert.equal(h.callbacks.size, 0);
  assert.ok(!h.messages.includes('风起花汀，静候君来'), 'cleared copy remains empty');
  h.runtime.update(config);
  h.runtime.dispose();
  h.runtime.update(config);
  assert.equal(h.callbacks.size, 0);
});

test('late asset completion cannot restart a disposed animation', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = await createHarness(() => pending);
  h.runtime.update(config);
  h.runtime.dispose();
  release();
  await flush();
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.backgrounds.length, 0);
});

test('missing artwork produces a visible error without a runaway animation or repeated loads', async () => {
  const h = await createHarness(async () => { throw new Error('missing synthetic asset'); });
  h.runtime.update(config);
  await flush();
  assert.equal(h.canvas.dataset.ready, 'error');
  assert.ok(h.messages.some(message => message.includes('素材加载失败')));
  assert.equal(h.callbacks.size, 0);
  h.runtime.update(config);
  assert.equal(h.imageCount(), h.expectedImages);
  h.runtime.dispose();
});
