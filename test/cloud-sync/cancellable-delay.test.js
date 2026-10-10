'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCancellableDelay } = require('../../src/shared/cancellable-delay');

test('long delays are segmented without changing the requested deadline', () => {
  const scheduled = [];
  const delay = createCancellableDelay({
    setTimeout(callback, ms) {
      const timer = { callback, ms, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout() {},
  });
  let calls = 0;
  delay.schedule(() => { calls += 1; }, 2 * (2 ** 31 - 1) + 10);
  assert.equal(scheduled[0].ms, 2 ** 31 - 1);
  scheduled[0].callback();
  assert.equal(scheduled[1].ms, 2 ** 31 - 1);
  scheduled[1].callback();
  assert.equal(scheduled[2].ms, 10);
  assert.equal(calls, 0);
  scheduled[2].callback();
  assert.equal(calls, 1);
  assert.equal(delay.isPending(), false);
});

test('replacing or cancelling a delay fences already queued callbacks', () => {
  const scheduled = [];
  const cleared = [];
  const delay = createCancellableDelay({
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
    clearTimeout: (timer) => cleared.push(timer),
  });
  const calls = [];
  delay.schedule(() => calls.push('old'), 1);
  delay.schedule(() => calls.push('new'), 2);
  scheduled[0]();
  assert.equal(delay.isPending(), true);
  delay.cancel();
  scheduled[1]();
  assert.deepEqual(calls, []);
  assert.deepEqual(cleared, [1, 2]);
  assert.equal(delay.isPending(), false);
});
