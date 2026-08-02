'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatBilibiliGiftLog } = require('../src/bilibili/danmaku/message-handlers');

test('formats a regular gift with a stable readable amount', () => {
  assert.equal(
    formatBilibiliGiftLog({
      userName: 'Alice',
      giftName: 'Rose',
      num: 2,
      totalPrice: 3.5,
      coinType: 'gold'
    }),
    '[Bilibili][Gift] user="Alice" gift="Rose" x2 amount=¥3.50'
  );
});

test('adds useful non-standard gift tags without noisy defaults', () => {
  assert.equal(
    formatBilibiliGiftLog({
      userName: 'Bob',
      giftName: 'Blind Box',
      num: 1,
      totalPrice: 15,
      coinType: 'guard',
      isBlindBox: true
    }),
    '[Bilibili][Gift] user="Bob" gift="Blind Box" x1 amount=¥15.00 blind-box coin=guard'
  );
});

test('uses safe fallbacks and escapes display names', () => {
  assert.equal(
    formatBilibiliGiftLog({ userName: 'A"lice', giftName: '', totalPrice: 0, coinType: 'silver' }),
    '[Bilibili][Gift] user="A\\\"lice" gift="未知礼物" x1 amount=¥0.00 coin=silver'
  );
});
