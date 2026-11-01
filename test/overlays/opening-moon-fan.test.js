'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const runtimePath = path.join(__dirname, '../../public/js/overlays/opening-moon-fan.js');

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
  assert.equal(h.callbacks.size, 0);
  h.runtime.update(config);
  assert.equal(h.imageCount(), h.expectedImages);
  h.runtime.dispose();
});
