'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const modulePath = path.join(__dirname, '../../public/js/admin/pk-score-calculator.js');

test('PK score estimates apply the selected first-win and double-period multipliers', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  for (const [firstWin, doublePeriod, batteries, barScore] of [
    [false, false, 50000, 50000],
    [false, true, 25000, 50000],
    [true, false, 25000, 25000],
    [true, true, 12500, 25000],
  ]) {
    assert.deepEqual({ ...calculatePkScore(1000, firstWin, doublePeriod) }, {
      batteries, barScore, awardedScore: 1000, awardFraction: 0,
    });
  }
});

test('first win applies before rounding so odd target scores remain exact', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  assert.deepEqual({ ...calculatePkScore(1, true, true) }, {
    batteries: 13, barScore: 26, awardedScore: 1, awardFraction: 0.04,
  });
  assert.deepEqual({ ...calculatePkScore(3, true, false) }, {
    batteries: 75, barScore: 75, awardedScore: 3, awardFraction: 0,
  });
});

test('battery estimates reach the target and one fewer battery cannot reach it', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  for (const target of [1, 2, 239]) {
    for (const firstWin of [false, true]) {
      for (const doublePeriod of [false, true]) {
        for (const eventBonus of [false, true]) {
          const result = calculatePkScore(target, firstWin, doublePeriod, { eventBonus });
          const cheaperBudget = (result.batteries - 1) / 10;
          const cheaper = calculatePkScore(cheaperBudget, firstWin, doublePeriod, { byAmount: true, eventBonus });
          assert.equal(result.awardedScore, target);
          assert.ok(cheaper.awardedScore < target);
        }
      }
    }
  }
});

test('zero needs no batteries, while invalid or imprecise targets are rejected', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  assert.deepEqual({ ...calculatePkScore(0, true, true) }, {
    batteries: 0, barScore: 0, awardedScore: 0, awardFraction: 0,
  });
  for (const target of [-1, 0.5, NaN, Infinity, '1000', Number.MAX_SAFE_INTEGER]) {
    assert.equal(calculatePkScore(target, false, true), null);
  }
});

test('a yuan budget buys whole batteries and the event bonus applies once at settlement', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  const options = { byAmount: true, eventBonus: true };
  const result = calculatePkScore('11.49', true, true, options);
  assert.equal(result.batteries, 114);
  assert.equal(result.barScore, 228);
  assert.equal(result.awardedScore, 10);
  assert.equal(result.awardFraction, 0.032);
  assert.equal(calculatePkScore('0.09', true, true, options).batteries, 0);
  for (const amount of ['', '-1', '1.001', '900719925474099.20']) {
    assert.equal(calculatePkScore(amount, false, false, options), null);
  }
});
