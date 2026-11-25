'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDanmakuDeliveryVerifier } = require('../../src/ai/danmaku-delivery-verifier');

test('delivery verifier requires every AI reply chunk from the sending account', async () => {
  let currentTime = 999;
  const verifier = createDanmakuDeliveryVerifier({ now: () => currentTime });

  // The HTTP request failed before registering a waiter. A retry sends the same text.
  verifier.trackSend({ accountUid: '9', mentionName: 'Alice', message: 'first' });
  currentTime += 1;
  verifier.trackSend({ accountUid: '9', mentionName: 'Alice', message: 'first' });
  verifier.observe({ uid: '9', userName: 'Bot', message: '@Alice first' });
  currentTime += 1;
  verifier.trackSend({ accountUid: '9', message: 'second' });
  verifier.observe({ uid: '9', userName: 'Bot', message: 'second' });

  assert.equal(
    await verifier.waitForDelivery({
      accountUid: '9',
      mentionName: 'Alice',
      messages: ['first', 'second'],
      sentAfter: 1000,
      timeoutMs: 5,
    }),
    true,
  );
});

test('delivery verifier rejects partial, duplicate, and wrong-account echoes', async () => {
  let currentTime = 2000;
  const verifier = createDanmakuDeliveryVerifier({ now: () => currentTime });

  verifier.trackSend({ accountUid: '9', message: 'same' });
  verifier.trackSend({ accountUid: '9', message: 'same' });
  verifier.observe({ uid: '8', userName: 'Other', message: 'same' });
  verifier.observe({ uid: '9', userName: 'Bot', message: 'same' });
  verifier.observe({ uid: '9', userName: 'Bot', message: 'different' });

  assert.equal(
    await verifier.waitForDelivery({
      accountUid: 9,
      messages: ['same', 'same'],
      sentAfter: 2000,
      timeoutMs: 5,
    }),
    false,
  );
});

test('delivery verifier can complete a pending wait from later room events', async () => {
  const verifier = createDanmakuDeliveryVerifier();
  const sentAfter = Date.now();
  const pending = verifier.waitForDelivery({
    accountUid: '9',
    messages: ['one', 'two'],
    sentAfter,
    timeoutMs: 50,
  });

  verifier.observe({ uid: '9', message: 'one' });
  verifier.observe({ uid: '9', message: 'two' });

  assert.equal(await pending, true);
});

test('early echoes stay with their tracked mentions even when the room returns bare text', async (t) => {
  const verifier = createDanmakuDeliveryVerifier({ now: () => 1000 });
  t.after(() => verifier.dispose());
  const send = { accountUid: '9', message: 'same' };
  const wait = { accountUid: '9', messages: ['same'], sentAfter: 1000, timeoutMs: 100 };
  verifier.trackSend({ ...send, mentionName: 'Bob' });
  verifier.observe({ uid: '9', message: 'same' });
  verifier.trackSend({ ...send, mentionName: '  Alice  ' });
  const alice = verifier.waitForDelivery({ ...wait, mentionName: 'Alice' });
  assert.equal(await verifier.waitForDelivery({ ...wait, mentionName: 'Bob' }), true);
  verifier.observe({ uid: '9', message: '@Alice same' });
  assert.equal(await alice, true);

  verifier.trackSend({ ...send, mentionName: ' \t ' });
  verifier.observe({ uid: '9', message: '@ same' });
  verifier.observe({ uid: '9', message: 'same' });
  assert.equal(await verifier.waitForDelivery(wait), true);
});

test('an early echo only consumes one remaining slot, leaving the surplus echo for another delivery', async (t) => {
  const verifier = createDanmakuDeliveryVerifier({ now: () => 1000 });
  t.after(() => verifier.dispose());
  for (const message of ['same', 'same', 'last']) {
    verifier.trackSend({ accountUid: '9', message, mentionName: '  Alice  ' });
    verifier.observe({ uid: '9', message: `@Alice ${message}` });
  }
  const wait = { accountUid: '9', mentionName: 'Alice', sentAfter: 1000, timeoutMs: 100 };
  assert.equal(await verifier.waitForDelivery({ ...wait, messages: ['same', 'last'] }), true);
  assert.equal(await verifier.waitForDelivery({ ...wait, messages: ['same'] }), true);
});

test('room traffic does not inspect other viewers’ text before or during delivery', async (t) => {
  const verifier = createDanmakuDeliveryVerifier({ now: () => 1000 });
  t.after(() => verifier.dispose());
  const viewer = { uid: '8', get message() { assert.fail('read unrelated message'); } };
  verifier.observe(viewer);
  verifier.trackSend({ accountUid: '9', mentionName: 'Alice', message: 'first' });
  verifier.observe(viewer);
  verifier.observe({ uid: '9', message: '@Alice first' });
  const pending = verifier.waitForDelivery({
    accountUid: '9', mentionName: 'Alice', messages: ['first', 'second', 'second'], sentAfter: 1000, timeoutMs: 1000,
  });
  verifier.observe(viewer);
  verifier.observe({ uid: '9', message: 'second' });
  verifier.observe({ uid: '9', message: '@Alice second' });
  assert.equal(await pending, true);
});

test('delivery verifier dispose clears pending timers and rejects new waits', async () => {
  const verifier = createDanmakuDeliveryVerifier();
  const pending = verifier.waitForDelivery({
    accountUid: '9',
    messages: ['never-arrives'],
    sentAfter: Date.now(),
    timeoutMs: 60000,
  });

  verifier.dispose();

  assert.equal(await pending, false);
  assert.equal(
    await verifier.waitForDelivery({
      accountUid: '9',
      messages: ['late'],
      timeoutMs: 60000,
    }),
    false,
  );
  verifier.dispose();
});
