'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { getOpeningConfig } = require('../../src/server/routes/opening-routes');
const { projectOverlayResponse } = require('../../src/server/overlay-projection');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('opening style defaults to the existing stage and validates before settings are written', () => {
  assert.equal(DEFAULT_SETTINGS.openingStyle, 'classic');
  for (const style of ['classic', 'pixel-cassette']) {
    const patch = normalizeSettingsPatch({ openingStyle: ` ${style} ` }, DEFAULT_SETTINGS);
    assert.equal(patch.error, undefined);
    assert.equal(patch.values.openingStyle, style);
    const config = getOpeningConfig({ settings: { get: () => patch.values } });
    assert.equal(config.style, style);
    assert.equal(projectOverlayResponse('opening', '/api/opening/config', config).style, style);
  }
  assert.match(normalizeSettingsPatch({ openingStyle: 'unknown' }, DEFAULT_SETTINGS).error, /openingStyle/);
  for (const value of [undefined, 'unknown']) {
    assert.equal(getOpeningConfig({ settings: { get: () => ({ openingStyle: value }) } }).style, 'classic');
  }
});

test('opening source follows the saved style unless its URL explicitly overrides it', async () => {
  const { parseConfig, mergeConfig } = await loadModuleExports(
    path.join(__dirname, '../../public/js/overlays/opening.js'), { URLSearchParams },
  );
  const remote = { style: 'pixel-cassette' };
  assert.equal(mergeConfig(remote, parseConfig(''), new URLSearchParams()).style, 'pixel-cassette');
  for (const style of ['classic', 'pixel-cassette', 'invalid']) {
    const query = `?style=${style}`;
    assert.equal(mergeConfig(remote, parseConfig(query), new URLSearchParams(query)).style,
      style === 'pixel-cassette' ? style : 'classic');
  }
});

test('pixel rendering owns one animation loop and releases it on hide, style switch and disposal', async () => {
  const callbacks = new Map();
  let id = 0;
  const { createPixelOpening } = await loadModuleExports(
    path.join(__dirname, '../../public/js/overlays/opening-pixel.js'), {
      Image: class { getAttribute() { return this.src || null; } },
      requestAnimationFrame: callback => { callbacks.set(++id, callback); return id; },
      cancelAnimationFrame: request => callbacks.delete(request),
    },
  );
  const runtime = createPixelOpening({ getContext: () => ({ fillRect() {} }) });
  const config = { active: true, paused: false, quality: 'normal', showNotes: true, showEq: true };
  runtime.update(config);
  runtime.update({ ...config, showNotes: false });
  assert.equal(callbacks.size, 1);
  const [request, frame] = [...callbacks][0];
  callbacks.delete(request);
  frame(1000);
  assert.equal(callbacks.size, 1);
  runtime.update({ ...config, paused: true });
  assert.equal(callbacks.size, 0);
  runtime.update(config);
  assert.equal(callbacks.size, 1);
  runtime.update({ ...config, active: false });
  assert.equal(callbacks.size, 0);
  runtime.update(config);
  runtime.dispose();
  runtime.update(config);
  assert.equal(callbacks.size, 0);
});

test('only the progress loops after six seconds while the scene keeps its animation time', async () => {
  let nextFrame;
  let rectangles = [];
  let portrait;
  const ctx = {
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); },
    drawImage(image, x, y) { portrait = { x, y }; },
  };
  const { createPixelOpening } = await loadModuleExports(
    path.join(__dirname, '../../public/js/overlays/opening-pixel.js'), {
      Image: class {
        complete = true;
        naturalWidth = 160;
        naturalHeight = 160;
        getAttribute() { return this.src || null; }
      },
      requestAnimationFrame: callback => { nextFrame = callback; return 1; },
      cancelAnimationFrame() {},
    },
  );
  const runtime = createPixelOpening({ getContext: () => ctx });
  runtime.update({ active: true, quality: 'normal', showNotes: true, showEq: true,
    pixelCharacterUrl: '/opening-character/test.png' });
  const samples = [0, 0.95, 1, 2, 3, 4, 5, 5.95, 6, 6.1, 7].map(time => {
    rectangles = [];
    nextFrame(time * 1000);
    return {
      portrait,
      progress: rectangles.filter(rect => rect.y === 204 && rect.width === 32 && rect.height === 8
        && rect.color === '#d35d8a').length,
      letters: rectangles.filter(rect => rect.y > 230),
      background: rectangles.slice(1, 20),
    };
  });
  assert.deepEqual(samples.map(frame => frame.progress), [0, 0, 1, 2, 3, 4, 5, 5, 0, 0, 1]);
  assert.notDeepEqual(samples[8].letters, samples[0].letters);
  assert.notDeepEqual(samples[8].background, samples[0].background);
  assert.notDeepEqual(samples[9].letters, samples[8].letters);
  assert.ok(samples.every(frame => frame.portrait.x === 160));
  assert.ok(new Set(samples.map(frame => frame.portrait.y)).size > 1);
  runtime.dispose();
});

test('pixel avatars start empty, fit the fixed area and update without restarting the scene', async () => {
  const images = [];
  const drawn = [];
  let nextFrame;
  let progress;
  const ctx = {
    fillRect(x, y, width, height) {
      if (x === 155 && y === 204 && height === 8) progress = this.fillStyle;
    },
    drawImage(image, x, y, width, height) { drawn.push({ image, x, y, width, height }); },
  };
  const { createPixelOpening, mergeConfig } = {
    ...await loadModuleExports(path.join(__dirname, '../../public/js/overlays/opening-pixel.js'), {
      Image: class { constructor() { images.push(this); } },
      requestAnimationFrame: callback => { nextFrame = callback; return 1; },
      cancelAnimationFrame() {},
    }),
    ...await loadModuleExports(path.join(__dirname, '../../public/js/overlays/opening.js'), { URLSearchParams }),
  };
  for (const unsafe of ['https://example.com/avatar.png', '/img/overlays/opening/pixel-cassette-avatar.png']) {
    assert.equal(mergeConfig({ pixelCharacterUrl: unsafe }, {}, new URLSearchParams()).pixelCharacterUrl, '');
  }
  const runtime = createPixelOpening({ getContext: () => ctx });
  const config = { active: true, quality: 'normal', characterUrl: '/opening-character/classic.png' };
  runtime.update(config);
  nextFrame(0);
  assert.equal(images.length, 0, 'classic images and bundled assets are not pixel defaults');
  assert.equal(drawn.length, 0);
  const sizes = [[32, 32], [4096, 4096], [2048, 1024], [800, 1600]];
  sizes.forEach(([naturalWidth, naturalHeight], index) => {
    const next = { ...config, pixelCharacterUrl: `/opening-character/avatar-${index}.png` };
    runtime.update(next);
    runtime.update(next);
    assert.equal(images.length, index + 1, 'config polling must reuse the current image');
    nextFrame((index + 1) * 1000 - 100);
    assert.equal(drawn.length, index, 'pending replacement must not draw the previous image');
    Object.assign(images.at(-1), { complete: true, naturalWidth, naturalHeight });
    nextFrame((index + 1) * 1000);
    const output = drawn.at(-1);
    assert.equal(Math.max(output.width, output.height), 160);
    assert.equal(output.width / output.height, naturalWidth / naturalHeight);
    assert.equal(output.x + output.width / 2, 240);
    assert.equal(progress, '#d35d8a', 'uploading must not reset elapsed progress');
  });
  runtime.update(config);
  nextFrame(5000);
  assert.equal(drawn.length, 4);
  assert.equal(progress, '#d35d8a', 'clearing must not reset elapsed progress');
  runtime.dispose();
});
