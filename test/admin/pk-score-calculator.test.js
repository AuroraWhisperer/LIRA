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
      batteries, barScore, awardedScore: 1000,
    });
  }
});

test('first win applies before rounding so odd target scores remain exact', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  assert.deepEqual({ ...calculatePkScore(1, true, true) }, {
    batteries: 13, barScore: 26, awardedScore: 1,
  });
  assert.deepEqual({ ...calculatePkScore(3, true, false) }, {
    batteries: 75, barScore: 75, awardedScore: 3,
  });
  assert.deepEqual({ ...calculatePkScore(1001, true, true) }, {
    batteries: 12513, barScore: 25026, awardedScore: 1001,
  });
});

test('switching first win keeps the 239-point target and excludes its multiplier from PK bar points', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  assert.deepEqual({ ...calculatePkScore(239, false, true) }, {
    batteries: 5975, barScore: 11950, awardedScore: 239,
  });
  assert.deepEqual({ ...calculatePkScore(239, true, true) }, {
    batteries: 2988, barScore: 5976, awardedScore: 239,
  });
});

test('battery estimates reach the target and one fewer battery cannot reach it', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  for (const target of [1, 2, 3, 49, 50, 51, 239, 999, 1000, 1001]) {
    for (const firstWin of [false, true]) {
      for (const doublePeriod of [false, true]) {
        const result = calculatePkScore(target, firstWin, doublePeriod);
        const scoreWithOneLess = Math.floor((result.batteries - 1) * (doublePeriod ? 2 : 1) / 50
          * (firstWin ? 2 : 1));
        assert.equal(result.awardedScore, target);
        assert.ok(scoreWithOneLess < target);
      }
    }
  }
});

test('zero needs no batteries, while invalid or imprecise targets are rejected', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  assert.deepEqual({ ...calculatePkScore(0, true, true) }, {
    batteries: 0, barScore: 0, awardedScore: 0,
  });
  for (const target of [-1, 0.5, NaN, Infinity, '1000', Number.MAX_SAFE_INTEGER]) {
    assert.equal(calculatePkScore(target, false, true), null);
  }
});
