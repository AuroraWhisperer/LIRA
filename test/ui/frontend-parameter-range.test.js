'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('balanced ranges reserve usable space on the short side without changing actual values', async () => {
  const { getParameterRangeProgress, getParameterRangeValue } = await loadModuleExports(
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
  assert.equal(getParameterRangeProgress({ ...input, min: '-2', max: '0.1', value: '0' }), 75);
  assert.equal(getParameterRangeProgress({ ...input, min: '-2', max: '2', value: '0' }), 50);
  assert.equal(getParameterRangeProgress({ ...input, value: '0', dataset: {} }), (0.1 / 2.1) * 100);
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
