'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  formatBilibiliGiftLog,
  formatBilibiliSuperChatLog
} = require('../src/bilibili/danmaku/message-handlers');
const { formatUnparsedGiftLikeCommandLog } = require('../src/bilibili/helpers');

test('formats a regular gift with a stable readable amount', () => {
  assert.equal(
    formatBilibiliGiftLog({
      userName: 'Alice',
      giftName: 'Rose',
      num: 2,
      totalPrice: 3.5,
      coinType: 'gold'
    }),
    '[Bilibili][Gift] status=parsed user="Alice" gift="Rose" x2 amount=¥3.50'
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
    '[Bilibili][Gift] status=parsed user="Bob" gift="Blind Box" x1 amount=¥15.00 blind-box coin=guard'
  );
});

test('uses safe fallbacks and escapes display names', () => {
  assert.equal(
    formatBilibiliGiftLog({ userName: 'A"lice', giftName: '', totalPrice: 0, coinType: 'silver' }),
    '[Bilibili][Gift] status=parsed user="A\\\"lice" gift="未知礼物" x1 amount=¥0.00 coin=silver'
  );
});

test('includes message correlation fields when supplied by the listener', () => {
  const line = formatBilibiliGiftLog({
    userName: 'Alice',
    giftName: 'Rose',
    num: 1,
    totalPrice: 1,
    cmd: 'SEND_GIFT',
    platformId: 'event-123',
    comboId: 'combo-456',
    messageTimestamp: 1785769654000
  }, { connectionGeneration: 2, connectionAttempt: 3 });

  assert.match(line, /^\[Bilibili\]\[Gift\] status=parsed user="Alice" gift="Rose" x1 amount=/);
  assert.equal(
    line.slice(line.indexOf('trace=')),
    'trace={"connectionGeneration":2,"connectionAttempt":3,"cmd":"SEND_GIFT","platformId":"event-123","comboId":"combo-456","messageTimestamp":"2026-08-03T15:07:34.000Z"}'
  );
});

test('formats rejected gift-like commands with the canonical gift prefix', () => {
  assert.equal(
    formatUnparsedGiftLikeCommandLog({
      cmd: 'SEND_GIFT',
      data: { uid: 123, mystery: true }
    }, 'known-gift-command', {
      status: 'rejected',
      connectionGeneration: 4,
      connectionAttempt: 7
    }),
    '[Bilibili][Gift] status=rejected reason=known-gift-command cmd=SEND_GIFT dataKeys=uid,mystery data={"uid":123,"mystery":true} trace={"connectionGeneration":4,"connectionAttempt":7}'
  );
});

test('formats every received SuperChat with connection correlation', () => {
  assert.equal(
    formatBilibiliSuperChatLog({
      uid: 123,
      userName: 'Alice',
      message: '支持主播',
      price: 30,
      messageTimestamp: 1785769654000
    }, {
      connectionGeneration: 2,
      connectionAttempt: 3,
      cmd: 'SUPER_CHAT_MESSAGE'
    }),
    '[Bilibili][SuperChat] status=received user="Alice" uid="123" price=30 message="支持主播" trace={"connectionGeneration":2,"connectionAttempt":3,"cmd":"SUPER_CHAT_MESSAGE","messageTimestamp":"2026-08-03T15:07:34.000Z"}'
  );
});
