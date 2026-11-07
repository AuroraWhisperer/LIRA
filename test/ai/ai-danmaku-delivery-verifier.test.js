'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createDanmakuDeliveryVerifier } = require('../../src/ai/danmaku-delivery-verifier');

test('delivery verifier requires every AI reply chunk from the sending account', async () => {
  let currentTime = 1000;
  const verifier = createDanmakuDeliveryVerifier({ now: () => currentTime });

  verifier.observe({ uid: '9', userName: 'Bot', message: '@Alice first' });
  currentTime += 1;
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

test('delivery verifier checks later events without repeatedly scanning room history', async (t) => {
  let visited = 0;
  const filename = path.join(__dirname, '../../src/ai/danmaku-delivery-verifier.js');
  const context = vm.createContext({
    module: { exports: {} }, require: createRequire(filename), setTimeout, clearTimeout,
    countVisit() { visited++; },
  });
  // Count event visits only in this module's VM; host Array iteration is untouched.
  vm.runInContext(`
    const iterate = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function* () {
      const iterator = iterate.call(this);
      for (let next = iterator.next(); !next.done; next = iterator.next()) {
        if (next.value && typeof next.value === 'object' && Object.hasOwn(next.value, 'observedAt')) countVisit();
        yield next.value;
      }
    };
  `, context);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const verifier = context.module.exports.createDanmakuDeliveryVerifier({ now: () => 1000 });
  t.after(() => verifier.dispose());
  for (let index = 0; index < 1000; index++) verifier.observe({ uid: `viewer-${index}`, message: 'ordinary' });
  verifier.observe({ uid: '9', message: '@Alice first' });
  const pending = verifier.waitForDelivery({
    accountUid: '9', mentionName: 'Alice', messages: ['first', 'second', 'second'], sentAfter: 1000, timeoutMs: 1000,
  });
  for (let index = 0; index < 1000; index++) verifier.observe({ uid: `viewer-${index}`, message: 'ordinary' });
  verifier.observe({ uid: '9', message: 'second' });
  verifier.observe({ uid: '9', message: '@Alice second' });
  assert.equal(await pending, true);
  assert.ok(visited <= 2200, `expected linear event matching, visited ${visited} events`);
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
