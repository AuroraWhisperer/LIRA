'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDanmakuDeliveryVerifier } = require('../src/ai/danmaku-delivery-verifier');

test('delivery verifier requires every AI reply chunk from the sending account', async () => {
  let currentTime = 1000;
  const verifier = createDanmakuDeliveryVerifier({ now: () => currentTime });

  verifier.observe({ uid: '9', userName: 'Bot', message: '@Alice first' });
  currentTime += 1;
  verifier.observe({ uid: '9', userName: 'Bot', message: 'second' });

  assert.equal(await verifier.waitForDelivery({
    accountUid: '9',
    mentionName: 'Alice',
    messages: ['first', 'second'],
    sentAfter: 1000,
    timeoutMs: 5
  }), true);
});

test('delivery verifier rejects partial, duplicate, and wrong-account echoes', async () => {
  let currentTime = 2000;
  const verifier = createDanmakuDeliveryVerifier({ now: () => currentTime });

  verifier.observe({ uid: '8', userName: 'Other', message: 'same' });
  verifier.observe({ uid: '9', userName: 'Bot', message: 'same' });
  verifier.observe({ uid: '9', userName: 'Bot', message: 'different' });

  assert.equal(await verifier.waitForDelivery({
    accountUid: 9,
    messages: ['same', 'same'],
    sentAfter: 2000,
    timeoutMs: 5
  }), false);
});

test('delivery verifier can complete a pending wait from later room events', async () => {
  const verifier = createDanmakuDeliveryVerifier();
  const sentAfter = Date.now();
  const pending = verifier.waitForDelivery({
    accountUid: '9',
    messages: ['one', 'two'],
    sentAfter,
    timeoutMs: 50
  });

  verifier.observe({ uid: '9', message: 'one' });
  verifier.observe({ uid: '9', message: 'two' });

  assert.equal(await pending, true);
});
