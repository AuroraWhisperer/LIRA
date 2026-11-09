'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { getOpeningConfig } = require('../../src/server/opening-service');
const { projectOverlayResponse } = require('../../src/server/overlay-projection');
const { loadModuleExports } = require('../helpers/frontend-modules');

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

test('pixel avatars accept only uploaded images, reuse them and clear stale replacements', async () => {
  const images = [];
  const drawn = [];
  let nextFrame;
  const ctx = {
    fillRect() {},
    drawImage(image) { drawn.push(image); },
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
  for (let index = 0; index < 2; index += 1) {
    const next = { ...config, pixelCharacterUrl: `/opening-character/avatar-${index}.png` };
    runtime.update(next);
    runtime.update(next);
    assert.equal(images.length, index + 1, 'config polling must reuse the current image');
    nextFrame((index + 1) * 1000 - 100);
    assert.equal(drawn.length, index, 'pending replacement must not draw the previous image');
    Object.assign(images.at(-1), { complete: true, naturalWidth: 64, naturalHeight: 64 });
    nextFrame((index + 1) * 1000);
    assert.equal(drawn.at(-1), images.at(-1));
  }
  runtime.update(config);
  nextFrame(3000);
  assert.equal(drawn.length, 2);
  runtime.dispose();
});
