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

test('first win requires a full 50-point bucket before doubling the awarded score', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  assert.deepEqual({ ...calculatePkScore(1, true, true) }, {
    batteries: 25, barScore: 50, awardedScore: 2,
  });
  assert.deepEqual({ ...calculatePkScore(3, true, false) }, {
    batteries: 100, barScore: 100, awardedScore: 4,
  });
  assert.deepEqual({ ...calculatePkScore(1001, true, true) }, {
    batteries: 12525, barScore: 25050, awardedScore: 1002,
  });
});

test('battery estimates reach the target and one fewer battery cannot reach it', async () => {
  const { calculatePkScore } = await loadModuleExports(modulePath);
  for (const target of [1, 2, 3, 49, 50, 51, 999, 1000, 1001]) {
    for (const firstWin of [false, true]) {
      for (const doublePeriod of [false, true]) {
        const result = calculatePkScore(target, firstWin, doublePeriod);
        const scoreWithOneLess = Math.floor((result.batteries - 1) * (doublePeriod ? 2 : 1) / 50)
          * (firstWin ? 2 : 1);
        assert.ok(result.awardedScore >= target);
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
