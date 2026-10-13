'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogRateLimit } = require('../../src/shared/log-rate-limit');

test('bursts retain first errors, admit different failures and summarize dropped repetitions after recovery', () => {
  let now = 0;
  const admit = createLogRateLimit({ now: () => now });
  for (let index = 0; index < 5; index += 1) assert.equal(admit('same').allowed, true);
  for (let index = 0; index < 1000; index += 1) assert.equal(admit('same').allowed, false);
  assert.equal(admit('different').allowed, true);
  now = 60_000;
  assert.deepEqual(admit('same'), { allowed: true, suppressed: 1000 });
  assert.deepEqual(admit('same'), { allowed: true, suppressed: 0 });
});

test('unique messages cannot bypass the aggregate budget and a clock rollback recovers', () => {
  let now = 100;
  const admit = createLogRateLimit({ now: () => now });
  let accepted = 0;
  for (let index = 0; index < 10_000; index += 1) accepted += Number(admit(String(index)).allowed);
  assert.equal(accepted, 120);
  now = 0;
  assert.deepEqual(admit('new'), { allowed: true, suppressed: 9880 });
});
