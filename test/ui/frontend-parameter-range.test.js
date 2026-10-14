'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('../helpers/admin-html');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

function tagById(html, id) {
  const tags = html.match(new RegExp(`<[^>]+\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'g')) || [];
  assert.equal(tags.length, 1, `${id} should exist once`);
  return tags[0];
}

test('parameter ranges preserve centered values and leave playback controls independent', async () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'components', 'parameter-range.css'), 'utf8');
  const { getParameterRangeOrigin, getParameterRangeProgress } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js'),
  );

  assert.equal(getParameterRangeProgress({ min: '0', max: '100', value: '25' }), 25);
  assert.equal(getParameterRangeProgress({ min: '-3000', max: '3000', value: '0' }), 50);
  const origin = (input) => JSON.parse(JSON.stringify(getParameterRangeOrigin(input)));
  assert.deepEqual(origin({ min: '-20', max: '20', value: '-5' }), {
    zeroProgress: 50,
    startProgress: 37.5,
    lengthProgress: 12.5,
    polarity: 'negative',
  });
  assert.deepEqual(origin({ min: '-20', max: '20', value: '10' }), {
    zeroProgress: 50,
    startProgress: 50,
    lengthProgress: 25,
    polarity: 'positive',
  });
  assert.deepEqual(origin({ min: '-20', max: '20', value: '0' }), {
    zeroProgress: 50,
    startProgress: 50,
    lengthProgress: 0,
    polarity: 'neutral',
  });

  for (const id of [
    'desktopLyricLetterSpacing',
    'desktopLyricShadowOffsetX',
    'desktopLyricShadowOffsetY',
    'desktopLyricInterludeOffsetEm',
    'desktopLyricTimeOffsetMs',
    'desktopLyricTranslateX',
    'desktopLyricTranslateY',
    'desktopLyricRotateX',
    'desktopLyricRotateY',
    'weSingLyricOffsetMs',
  ]) {
    const input = tagById(html, id);
    assert.match(input, /^<input\b/);
    assert.match(input, /\stype=["']range["']/);
    const classes = input.match(/\sclass=["']([^"']*)["']/)?.[1].split(/\s+/) || [];
    assert.ok(classes.includes('parameter-range'));
    assert.ok(classes.includes('parameter-range--centered'));
  }
  for (const id of ['playbackSeek', 'playbackVolume']) {
    const classes = tagById(html, id).match(/\sclass=["']([^"']*)["']/)?.[1].split(/\s+/) || [];
    assert.equal(classes.includes('parameter-range'), false);
  }
  assert.match(styles, /var\(--parameter-range-origin-length\)/);
  assert.match(styles, /var\(--parameter-range-zero-position\)/);
  const focusRule = styles.match(/:focus-visible\s*\{([^}]+)\}/)?.[1];
  assert.ok(focusRule, 'keyboard focus has a visible indicator');
  const outline = focusRule.match(/(?:^|;)\s*outline\s*:\s*([^;]+)/)?.[1];
  assert.ok(outline);
  assert.doesNotMatch(outline, /\b(?:none|transparent)\b|^0(?:px)?(?:\s|$)/);
});

test('balanced ranges reserve usable space on the short side without changing actual values', async () => {
  const { getParameterRangeProgress, getParameterRangeOrigin, getParameterRangeValue } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js'),
  );
  const input = { min: '-0.1', max: '2', step: '0.01', dataset: { rangeScale: 'balanced' } };
  for (const [value, progress] of [[-0.1, 0], [-0.05, 12.5], [0, 25], [1, 62.5], [2, 100]]) {
    input.value = String(value);
    assert.equal(getParameterRangeProgress(input), progress);
    assert.equal(getParameterRangeValue(input, progress), value);
  }
  assert.equal(getParameterRangeValue(input, -10), -0.1);
  assert.equal(getParameterRangeValue(input, 110), 2);
  assert.equal(getParameterRangeValue(input, 8), -0.07);
  assert.deepEqual(JSON.parse(JSON.stringify(getParameterRangeOrigin({ ...input, value: '-0.05' }))), {
    zeroProgress: 25, startProgress: 12.5, lengthProgress: 12.5, polarity: 'negative',
  });
  assert.equal(getParameterRangeProgress({ ...input, min: '-2', max: '0.1', value: '0' }), 75);
  assert.equal(getParameterRangeProgress({ ...input, min: '-2', max: '2', value: '0' }), 50);
  assert.equal(getParameterRangeProgress({ ...input, value: '0', dataset: {} }), (0.1 / 2.1) * 100);
  assert.match(tagById(readAdminHtml(), 'desktopLyricLetterSpacing'), /data-range-scale="balanced"/);
});

test('balanced pointer input uses actual values, binds once and releases listeners on disposal', async () => {
  const { initParameterRanges, disposeParameterRanges } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js'),
    { Event },
  );
  class RangeInput extends EventTarget {
    min = '-0.1';
    max = '2';
    step = '0.01';
    value = '0';
    dataset = { rangeScale: 'balanced' };
    style = { setProperty() {} };
    matches() { return true; }
    getBoundingClientRect() { return { left: 10, width: 218 }; }
    focus() { this.focused = true; }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
  }
  const input = new RangeInput();
  const values = [];
  let changes = 0;
  input.addEventListener('input', () => values.push(input.value));
  input.addEventListener('change', () => changes++);
  const pointer = (type, clientX) => input.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1, isPrimary: true, button: 0, clientX,
  }));
  initParameterRanges(input);
  initParameterRanges(input);
  pointer('pointerdown', 44);
  assert.equal(input.value, '-0.05');
  pointer('pointermove', 144);
  pointer('pointerup', 144);
  assert.deepEqual(values, ['-0.05', '1']);
  assert.equal(changes, 1);
  assert.equal(input.focused, true);
  assert.equal(input.captured, null);
  input.disabled = true;
  pointer('pointerdown', 19);
  assert.equal(input.value, '1');
  input.disabled = false;
  pointer('pointerdown', 19);
  pointer('pointercancel', 19);
  assert.equal(input.value, '-0.1');
  assert.equal(input.captured, null);
  assert.equal(changes, 2);
  disposeParameterRanges(input);
  pointer('pointerdown', 219);
  assert.equal(input.value, '-0.1');
  initParameterRanges(input);
  pointer('pointerdown', 219);
  pointer('pointerup', 219);
  assert.equal(input.value, '2');
  assert.equal(changes, 3);
});
