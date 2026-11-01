'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { getOpeningConfig } = require('../../src/server/opening-service');
const { projectOverlayResponse } = require('../../src/server/overlay-projection');
const { loadModuleExports } = require('../helpers/frontend-modules');

// Progress cells are found from the drawing itself: rows of five equal cells
// that stay in place while their colour changes. Filled cells are those whose
// colour differs from the empty first frame, so artwork coordinates and palette
// values can change without editing this test.
function fiveCellRows(rects) {
  const rows = new Map();
  for (const rect of rects) {
    const key = `${rect.y}:${rect.width}:${rect.height}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(rect);
  }
  return new Map([...rows].filter(([, cells]) => cells.length === 5 && new Set(cells.map(cell => cell.x)).size === 5));
}

function progressCounter(emptyFrame) {
  const empty = fiveCellRows(emptyFrame);
  return (rects) => {
    const counts = [...fiveCellRows(rects)]
      .filter(([key, cells]) => empty.has(key) && cells.every((cell, index) => cell.x === empty.get(key)[index].x))
      .map(([key, cells]) => cells.filter((cell, index) => cell.color !== empty.get(key)[index].color).length)
      .filter(count => count > 0);
    assert.ok(counts.every(count => count === counts[0]), 'every progress indicator agrees');
    return counts[0] || 0;
  };
}

test('opening style validates before settings are written and falls back to the classic stage', () => {
  for (const style of ['classic', 'pixel-cassette', 'moonlit-fan']) {
    const patch = normalizeSettingsPatch({ openingStyle: ` ${style} ` }, DEFAULT_SETTINGS);
    assert.equal(patch.error, undefined);
    assert.equal(patch.values.openingStyle, style);
    const config = getOpeningConfig({ settings: { get: () => patch.values } });
    assert.equal(config.style, style);
    assert.equal(projectOverlayResponse('opening', '/api/opening/config', config).style, style);
  }
  assert.ok(normalizeSettingsPatch({ openingStyle: 'unknown' }, DEFAULT_SETTINGS).error);
  for (const value of [undefined, 'unknown']) {
    assert.equal(getOpeningConfig({ settings: { get: () => ({ openingStyle: value }) } }).style, 'classic');
  }
});

test('opening source follows the saved style unless its URL explicitly overrides it', async () => {
  const { parseConfig, mergeConfig } = await loadModuleExports(
    path.join(__dirname, '../../public/js/overlays/opening.js'), { URLSearchParams },
  );
  const remote = { style: 'pixel-cassette', quality: 'low', enabled: false,
    styles: { classic: { style: 'classic', quality: 'high', audioUrl: '/opening-media/classic.mp3' },
      'pixel-cassette': { style: 'pixel-cassette', quality: 'low', audioUrl: '/opening-media/pixel.mp3' } } };
  assert.equal(mergeConfig(remote, parseConfig(''), new URLSearchParams()).style, 'pixel-cassette');
  const classic = mergeConfig(remote, parseConfig('?style=classic'), new URLSearchParams('style=classic'));
  assert.equal(classic.quality, 'high');
  assert.equal(classic.audioUrl, '/opening-media/classic.mp3');
  assert.equal(classic.enabled, false);
  for (const style of ['moonlit-fan', 'invalid']) {
    const query = `?style=${style}`;
    assert.equal(mergeConfig(remote, parseConfig(query), new URLSearchParams(query)).style,
      style === 'invalid' ? 'classic' : style);
  }
});

test('moonlit text preserves an explicit empty value while missing values keep defaults', async () => {
  const { mergeConfig } = await loadModuleExports(
    path.join(__dirname, '../../public/js/overlays/opening.js'), { URLSearchParams },
  );
  const merge = value => mergeConfig(value, {}, new URLSearchParams());
  const defaults = merge({ style: 'moonlit-fan' });
  const empty = merge({ style: 'moonlit-fan', title: '', subtitle: '  ', footer: '' });
  for (const field of ['title', 'subtitle', 'footer']) {
    assert.equal(empty[field], '');
    assert.ok(defaults[field]);
  }
  assert.equal(merge({ style: 'moonlit-fan', title: ' 新标题 ' }).title, '新标题');
  assert.equal(merge({ style: 'classic', title: '' }).title, merge({ style: 'classic' }).title);
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

test('pixel avatars start empty, accept only uploaded images and update without restarting the scene', async () => {
  const images = [];
  const drawn = [];
  let nextFrame;
  let rectangles = [];
  const ctx = {
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); },
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
  const progress = progressCounter(rectangles);
  const frame = (time) => { rectangles = []; nextFrame(time); return progress(rectangles); };
  assert.equal(images.length, 0, 'classic images and bundled assets are not pixel defaults');
  assert.equal(drawn.length, 0);
  const sizes = [[32, 32], [4096, 4096], [2048, 1024], [800, 1600]];
  sizes.forEach(([naturalWidth, naturalHeight], index) => {
    const next = { ...config, pixelCharacterUrl: `/opening-character/avatar-${index}.png` };
    runtime.update(next);
    runtime.update(next);
    assert.equal(images.length, index + 1, 'config polling must reuse the current image');
    frame((index + 1) * 1000 - 100);
    assert.equal(drawn.length, index, 'pending replacement must not draw the previous image');
    Object.assign(images.at(-1), { complete: true, naturalWidth, naturalHeight });
    assert.equal(frame((index + 1) * 1000), index + 1, 'uploading must not reset elapsed progress');
  });
  runtime.update(config);
  assert.equal(frame(5000), 5, 'clearing must not reset elapsed progress');
  assert.equal(drawn.length, 4);
  runtime.dispose();
});
