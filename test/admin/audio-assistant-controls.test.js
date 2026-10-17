'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve('public/js/admin/audio-assistant-controls.js');

test('audio parameter writes retain a newer same-value edit while earlier requests complete', async () => {
  const { createAudioParameterQueue } = await loadModuleExports(entry);
  const sends = [];
  const completions = [];
  const queue = createAudioParameterQueue((value) => {
    sends.push(JSON.parse(JSON.stringify(value)));
    return new Promise((resolve) => completions.push(resolve));
  }, () => {});
  queue.change('semitones', 1);
  const first = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  queue.change('semitones', 2);
  const second = queue.flush();
  queue.change('semitones', 1);
  completions[0](true);
  await first;
  assert.equal(queue.pending.semitones, 1, 'The newer edit must not be cleared just because its value matches an older request');
  const third = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  completions[1](true);
  await second;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.pending.semitones, 1);
  completions[2](true);
  assert.equal(await third, true);
  assert.deepEqual(sends, [{ semitones: 1 }, { semitones: 2 }, { semitones: 1 }]);
  assert.equal(Object.keys(queue.pending).length, 0);
});

test('audio parameter queue reports failed changes before a caller starts playback and can retry', async () => {
  const { createAudioParameterQueue, formatAudioParameter } = await loadModuleExports(entry);
  let success = false;
  const queue = createAudioParameterQueue(async () => success, () => {});
  queue.change('volume', 0);
  assert.equal(await queue.flush(), false);
  assert.equal(await queue.flush(), true, 'A handled failure must not block later device refresh or file selection');
  success = true;
  queue.change('volume', 0);
  assert.equal(await queue.flush(), true);
  assert.equal(formatAudioParameter('strength', 0), '原唱');
  assert.equal(formatAudioParameter('speedPercent', 150), '1.50×');
  assert.equal(formatAudioParameter('semitones', -12), '-12 Key');
});
