'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createRetryPolicy } = require('../src/electron/license/retry-policy');
const {
  createLicenseManager,
  LicenseState,
} = require('../src/electron/license/license-manager');
const {
  RemoteLicenseError,
} = require('../src/electron/license/remote-license-client');

// ---- retry policy unit tests ----

test('retry policy produces capped exponential delays with deterministic jitter', () => {
  const policy = createRetryPolicy({
    baseMs: 5000,
    capMs: 60000,
    maxAttempts: 10,
    jitter: () => 0.5,
  });
  assert.deepEqual(
    [
      policy.nextDelay(),
      policy.nextDelay(),
      policy.nextDelay(),
      policy.nextDelay(),
      policy.nextDelay(),
    ],
    [5000, 10000, 20000, 40000, 60000],
  );
  assert.equal(policy.attempts, 5);
});

test('retry policy jitter bounds the delay within [0.5x, 1.5x)', () => {
  const low = createRetryPolicy({ baseMs: 5000, jitter: () => 0 });
  assert.equal(low.nextDelay(), 2500);
  const high = createRetryPolicy({ baseMs: 5000, jitter: () => 0.9999 });
  const delay = high.nextDelay();
  assert.ok(
    delay >= 2500 && delay < 7500,
    `delay ${delay} must stay inside the jitter window`,
  );
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

function createFakeTimers() {
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
    runPendingWithDelay: (delay) => {
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
      handle.fn();
    },
    delays: () => handles.filter((h) => !h.cleared).map((h) => h.delay),
  };
}

function createManagerHarness({
  verifyExpiresIn = () => '10m',
  randomSource = () => 0.5,
} = {}) {
  const identity = { deviceId: 'd', publicKeyPem: 'public' };
  const state = { value: identity };
  const calls = { challenges: 0, verifies: 0 };
  const generated = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyPair = {
    privateKeyPem: generated.privateKey,
    publicKeyPem: generated.publicKey,
    keyProtection: 'dpapi',
  };
  const stateStore = {
    read: () => state.value,
    write: (value) => (state.value = value),
  };
  const keyStore = {
    loadPrivateKey: () => keyPair.privateKeyPem,
    loadOrCreate: () => keyPair,
  };
  const fingerprintProvider = {
    collect: async () => ({
      version: 1,
      machineGuidHash: 'a'.repeat(64),
      smbiosUuidHash: 'b'.repeat(64),
    }),
  };
  const remoteControl = { challengeError: null };
  const remote = {
    challenge: async () => {
      calls.challenges += 1;
      if (remoteControl.challengeError) throw remoteControl.challengeError;
      return { challengeId: `c${calls.challenges}`, nonce: 'n' };
    },
    verify: async () => {
      calls.verifies += 1;
      return {
        accessToken: `token-${calls.verifies}`,
        expiresIn: verifyExpiresIn(calls.verifies),
        deviceId: 'd',
        licenseId: 'l',
        streamer: { accountName: 'mlbb', subdomain: 'mlbb' },
      };
    },
    heartbeat: async () => ({ ok: true }),
    profile: async () => ({ streamer: { accountName: 'mlbb' } }),
    syncSongs: async (songs, token) => ({
      ok: true,
      count: songs.length,
      token,
    }),
    getSongPageBackground: async () => ({ ok: true, background: null }),
    uploadSongPageBackground: async () => ({ ok: true, background: null }),
    deleteSongPageBackground: async () => ({ ok: true, background: null }),
  };
  const timers = createFakeTimers();
  const manager = createLicenseManager({
    stateStore,
    keyStore,
    fingerprintProvider,
    remoteClient: remote,
    buildInfoProvider: () => ({
      appVersion: '4.0.0',
      buildId: 'dev',
      integrityStatus: 'unverified',
    }),
    randomSource,
    timers,
  });
  return { manager, calls, remoteControl, timers };
}

async function flushMicrotasks(rounds = 20) {
  for (let i = 0; i < rounds; i += 1)
    await new Promise((resolve) => setImmediate(resolve));
}

// The maintenance renewal delay derives from two Date.now() calls, so it can
// be a few ms below the nominal 510s under parallel test load. Locate it as
// "the pending timer that is not the 150s heartbeat" instead of exact match.
const HEARTBEAT_DELAY = 150000;

function renewalDelayOf(timers) {
  const delays = timers.delays().filter((d) => d !== HEARTBEAT_DELAY);
  assert.equal(
    delays.length,
    1,
    `expected exactly one renewal timer, got ${delays.join(',')}`,
  );
  return delays[0];
}

test('renewal failure schedules bounded exponential retries and exhausts into needs_connection', async () => {
  const { manager, calls, remoteControl, timers } = createManagerHarness();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  const maintenanceDelay = renewalDelayOf(timers);
  assert.ok(
    maintenanceDelay > 500000 && maintenanceDelay <= 510000,
    `maintenance renewal should be ~510s, got ${maintenanceDelay}`,
  );

  remoteControl.challengeError = new RemoteLicenseError(
    'REQUEST_TIMEOUT',
    'timeout',
    { retryable: true },
  );

  const expectedDelays = [
    5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000, 60000, 60000,
  ];
  let timerDelay = maintenanceDelay;
  for (const expected of expectedDelays) {
    timers.runPendingWithDelay(timerDelay);
    await flushMicrotasks();
    assert.equal(
      manager.getState(),
      LicenseState.AUTHORIZED,
      'token still valid: state must stay authorized while retrying',
    );
    timerDelay = expected;
  }

  // attempts exhausted: the next failure must stop retrying and drop to needs_connection
  timers.runPendingWithDelay(60000);
  await flushMicrotasks();
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(
    timers.pending().length,
    0,
    'no further retry timers may be scheduled',
  );
  assert.ok(
    calls.challenges >= 11,
    `expected at least 11 challenge attempts, got ${calls.challenges}`,
  );
  manager.dispose();
});

test('renewal retry delay is clamped by the remaining token lifetime', async () => {
  const { manager, remoteControl, timers } = createManagerHarness({
    verifyExpiresIn: () => '3s',
  });
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);

  remoteControl.challengeError = new RemoteLicenseError(
    'REQUEST_TIMEOUT',
    'timeout',
    { retryable: true },
  );
  // renewal timer for a 3s token: max(30000, 3000 - 90000) = 30000
  timers.runPendingWithDelay(30000);
  await flushMicrotasks();

  const retryDelays = timers.delays().filter((d) => d !== 150000);
  assert.equal(retryDelays.length, 1);
  assert.ok(
    retryDelays[0] <= 3000,
    `retry delay ${retryDelays[0]} must not outlive the token`,
  );
  assert.ok(
    retryDelays[0] >= 1000,
    `retry delay ${retryDelays[0]} must stay above the 1s floor`,
  );
  manager.dispose();
});

test('successful renewal resets the backoff sequence', async () => {
  const { manager, remoteControl, timers } = createManagerHarness();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);

  remoteControl.challengeError = new RemoteLicenseError(
    'REQUEST_TIMEOUT',
    'timeout',
    { retryable: true },
  );
  timers.runPendingWithDelay(renewalDelayOf(timers));
  await flushMicrotasks();
  timers.runPendingWithDelay(5000);
  await flushMicrotasks();
  assert.ok(
    timers.delays().includes(10000),
    'second retry should use the 10s backoff step',
  );

  remoteControl.challengeError = null;
  timers.runPendingWithDelay(10000);
  await flushMicrotasks();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  const rescheduled = renewalDelayOf(timers);
  assert.ok(
    rescheduled > 500000 && rescheduled <= 510000,
    'success should reschedule normal maintenance',
  );

  remoteControl.challengeError = new RemoteLicenseError(
    'REQUEST_TIMEOUT',
    'timeout',
    { retryable: true },
  );
  timers.runPendingWithDelay(rescheduled);
  await flushMicrotasks();
  assert.ok(
    timers.delays().includes(5000),
    'backoff must restart from the base delay after a success',
  );
  manager.dispose();
});
