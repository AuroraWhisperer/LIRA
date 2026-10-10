'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDisplayDemand } = require('../../src/scenes/display-demand');

test('display reads share one lease and release it after the last reader becomes idle', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const demand = createDisplayDemand();
  t.after(() => demand.dispose());
  const changes = [];
  const unsubscribe = demand.subscribe((active) => changes.push(active));
  assert.deepEqual(changes, [false]);
  demand.touch();
  demand.touch();
  t.mock.timers.tick(10000);
  demand.touch();
  t.mock.timers.tick(14999);
  assert.deepEqual(changes, [false, true]);
  t.mock.timers.tick(1);
  assert.deepEqual(changes, [false, true, false]);
  demand.touch();
  assert.deepEqual(changes, [false, true, false, true]);
  demand.dispose();
  demand.dispose();
  demand.touch();
  t.mock.timers.tick(30000);
  assert.deepEqual(changes, [false, true, false, true, false]);
  unsubscribe();
});

test('late subscribers see current demand and unsubscribed consumers receive no callbacks', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const demand = createDisplayDemand();
  demand.touch();
  const changes = [];
  const unsubscribe = demand.subscribe((active) => changes.push(active));
  assert.deepEqual(changes, [true]);
  unsubscribe();
  demand.dispose();
  assert.deepEqual(changes, [true]);
  demand.subscribe((active) => changes.push(active))();
  assert.deepEqual(changes, [true, false]);
});
