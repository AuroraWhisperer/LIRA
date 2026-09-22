'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isBilibiliDuplicateGuardToast } = require('../src/bilibili/parsers/gift-command-utils');

test('guard toast source supports option and top-level variants without replacing zero', () => {
  for (const data of [
    { option: { source: 2 } },
    { source: 2 },
    { source: '2' },
    { option: { source: null }, source: 2 },
  ]) {
    assert.equal(isBilibiliDuplicateGuardToast({ cmd: 'USER_TOAST_MSG_V2', data }), true);
  }
  for (const data of [{}, { option: { source: 0 }, source: 2 }, { option: { source: 1 }, source: 2 }]) {
    assert.equal(isBilibiliDuplicateGuardToast({ cmd: 'USER_TOAST_MSG_V2', data }), false);
  }
  assert.equal(isBilibiliDuplicateGuardToast({ cmd: 'GUARD_BUY', data: { source: 2 } }), false);
});
