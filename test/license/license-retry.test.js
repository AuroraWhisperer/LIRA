'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRetryPolicy } = require('../../src/electron/license/retry-policy');
const { LicenseState } = require('../../src/electron/license/license-manager');
const { RemoteLicenseError } = require('../../src/electron/license/remote-license-client');
const { createHarness } = require('../helpers/license-manager-harness');

// ---- retry policy unit tests ----

test('retry policy produces capped exponential delays with deterministic jitter', () => {
  const policy = createRetryPolicy({
    baseMs: 5000,
    capMs: 60000,
    maxAttempts: 10,
    jitter: () => 0.5,
  });
  assert.deepEqual(
    [policy.nextDelay(), policy.nextDelay(), policy.nextDelay(), policy.nextDelay(), policy.nextDelay()],
    [5000, 10000, 20000, 40000, 60000],
  );
  assert.equal(policy.attempts, 5);
});

test('retry policy jitter bounds the delay within [0.5x, 1.5x)', () => {
  const low = createRetryPolicy({ baseMs: 5000, jitter: () => 0 });
  assert.equal(low.nextDelay(), 2500);
  const high = createRetryPolicy({ baseMs: 5000, jitter: () => 0.9999 });
  const delay = high.nextDelay();
  assert.ok(delay >= 2500 && delay < 7500, `delay ${delay} must stay inside the jitter window`);
});

test('retry policy returns null after maxAttempts and reset restarts the sequence', () => {
  const policy = createRetryPolicy({
    baseMs: 5000,
    capMs: 60000,
    maxAttempts: 3,
    jitter: () => 0.5,
  });
  assert.equal(policy.nextDelay(), 5000);
  assert.equal(policy.nextDelay(), 10000);
  assert.equal(policy.nextDelay(), 20000);
  assert.equal(policy.nextDelay(), null);
  assert.equal(policy.nextDelay(), null);
  policy.reset();
  assert.equal(policy.attempts, 0);
  assert.equal(policy.nextDelay(), 5000);
});

// ---- license manager integration ----

const NOW = Date.parse('2026-10-07T00:00:00.000Z');
const HEARTBEAT_DELAY = 150000;
const MAINTENANCE_DELAY = 510000; // 10m token minus the 90s early-renewal window

function createFakeTimers(clock) {
  const handles = [];
  let nextId = 0;
  return {
    setTimeout: (fn, delay) => {
      const handle = { id: ++nextId, fn, delay, cleared: false };
      handles.push(handle);
      return handle;
    },
    clearTimeout: (handle) => {
      if (handle) handle.cleared = true;
    },
    pending: () => handles.filter((h) => !h.cleared),
    runPendingWithDelay: (delay, { advanceClock = false } = {}) => {
      const handle = handles.find((h) => !h.cleared && h.delay === delay);
      assert.ok(
        handle,
        `expected a pending timer with delay ${delay}, got ${
          handles
            .filter((h) => !h.cleared)
            .map((h) => h.delay)
            .join(',') || '(none)'
        }`,
      );
      handle.cleared = true;
      if (advanceClock) clock.now += delay;
      handle.fn();
    },
    delays: () => handles.filter((h) => !h.cleared).map((h) => h.delay),
  };
}

function createRetryHarness(t, options = {}) {
  const clock = { now: NOW };
  t.mock.method(Date, 'now', () => clock.now);
  const timers = createFakeTimers(clock);
  const harness = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    randomSource: () => 0.5,
    timers,
    ...options,
  });
  t.after(() => harness.manager.dispose());
  return { ...harness, timers };
}

async function flushMicrotasks(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

const retryableTimeout = () => new RemoteLicenseError('REQUEST_TIMEOUT', 'timeout', { retryable: true });

test('renewal failure schedules bounded exponential retries and exhausts into needs_connection', async (t) => {
  const { manager, calls, control, timers } = createRetryHarness(t);
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.deepEqual(timers.delays().sort((a, b) => a - b), [HEARTBEAT_DELAY, MAINTENANCE_DELAY]);

  const bootstrapChallenges = calls.challenges;
  control.challengeError = retryableTimeout();
  const retryDelays = [5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000, 60000, 60000];
  let timerDelay = MAINTENANCE_DELAY;
  for (const expected of retryDelays) {
    timers.runPendingWithDelay(timerDelay);
    await flushMicrotasks();
    assert.equal(
      manager.getState(),
      LicenseState.AUTHORIZED,
      'token still valid: state must stay authorized while retrying',
    );
    assert.deepEqual(timers.delays().filter((delay) => delay !== HEARTBEAT_DELAY), [expected]);
    timerDelay = expected;
  }

  // attempts exhausted: the next failure must stop retrying and drop to needs_connection
  timers.runPendingWithDelay(60000);
  await flushMicrotasks();
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(timers.pending().length, 0, 'no further retry timers may be scheduled');
  // One maintenance renewal plus every scheduled retry; nothing after exhaustion.
  assert.equal(calls.challenges - bootstrapChallenges, 1 + retryDelays.length);
});

test('renewal retry delay is clamped by the remaining token lifetime', async (t) => {
  const { manager, control, timers } = createRetryHarness(t, { verifyExpiresIn: () => '3s' });
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  // A 3s token renews at half its lifetime; the 5s backoff would outlive the remaining 1.5s.
  control.challengeError = retryableTimeout();
  timers.runPendingWithDelay(1500, { advanceClock: true });
  await flushMicrotasks();
  assert.deepEqual(timers.delays().filter((delay) => delay !== HEARTBEAT_DELAY), [1500]);
});

test('successful renewal resets the backoff sequence', async (t) => {
  const { manager, control, timers } = createRetryHarness(t);
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  const renewalDelays = () => timers.delays().filter((delay) => delay !== HEARTBEAT_DELAY);

  control.challengeError = retryableTimeout();
  timers.runPendingWithDelay(MAINTENANCE_DELAY);
  await flushMicrotasks();
  timers.runPendingWithDelay(5000);
  await flushMicrotasks();
  assert.deepEqual(renewalDelays(), [10000]);

  control.challengeError = null;
  timers.runPendingWithDelay(10000);
  await flushMicrotasks();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.deepEqual(renewalDelays(), [MAINTENANCE_DELAY], 'success reschedules normal maintenance');

  control.challengeError = retryableTimeout();
  timers.runPendingWithDelay(MAINTENANCE_DELAY);
  await flushMicrotasks();
  assert.deepEqual(renewalDelays(), [5000], 'backoff restarts from the base delay after a success');
});
