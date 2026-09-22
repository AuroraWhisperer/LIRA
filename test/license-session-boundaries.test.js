'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('./helpers/license-manager-harness');
const { LicenseState } = require('../src/electron/license/license-manager');
const { RemoteLicenseError } = require('../src/electron/license/remote-license-client');

function createTimers() {
  const pending = new Set();
  return {
    pending,
    setTimeout(fn, delay) {
      const handle = { fn, delay };
      pending.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
    async run(handle) {
      pending.delete(handle);
      handle.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('automatic renewal before the next heartbeat includes its session and cannot take over', async (t) => {
  const timers = createTimers();
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd' },
    timers,
  });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  const renewal = [...timers.pending].find((timer) => timer.delay > 150000);
  remote.verify = async (request) => {
    assert.equal(request.renewalSessionId, 'session-1');
    throw new RemoteLicenseError('SESSION_SUPERSEDED', 'taken over', { status: 401 });
  };
  await timers.run(renewal);
  assert.deepEqual(calls.heartbeatTokens, []);
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  assert.equal(timers.pending.size, 0);
});

test('network recovery retains the renewal prerequisite; only user retry removes it', async (t) => {
  const timers = createTimers();
  const { manager, remote } = createHarness({ identity: { deviceId: 'd' }, timers });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  remote.profile = async () => {
    throw new RemoteLicenseError('DEVICE_SESSION_INVALID', 'stale', { status: 401 });
  };
  const challenge = remote.challenge;
  remote.challenge = async () => {
    throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', { retryable: true });
  };
  await assert.rejects(manager.getProfile());
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  remote.challenge = challenge;
  const verify = remote.verify;
  remote.verify = async (request) => {
    assert.equal(request.renewalSessionId, 'session-1');
    throw new RemoteLicenseError('SESSION_SUPERSEDED', 'taken over', { status: 401 });
  };
  await manager.resume();
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  remote.verify = async (request) => {
    assert.equal(Object.hasOwn(request, 'renewalSessionId'), false);
    return verify(request);
  };
  await manager.retry();
  assert.equal(manager.isAuthorized(), true);
});

test('a verify response without its required session ID cannot authorize or auto-recover', async (t) => {
  const { manager, remote, calls } = createHarness({ identity: { deviceId: 'd' } });
  t.after(() => manager.dispose());
  const verify = remote.verify;
  remote.verify = async (request) => {
    const result = await verify(request);
    delete result.sessionId;
    return result;
  };
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  await manager.resume();
  assert.equal(calls.verifies, 1);
});

test('one second token expires locally without any protected request or timer callback', async (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const timers = createTimers();
  const { manager, remote, state } = createHarness({
    identity: { deviceId: 'd' },
    timers,
    verifyExpiresIn: () => '1s',
  });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  assert.equal(manager.isAuthorized(), true);
  const renewal = [...timers.pending].find((timer) => timer.delay < 1000);
  assert.equal(renewal.delay, 500);
  remote.challenge = async () => {
    throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', { retryable: true });
  };
  now += 500;
  await timers.run(renewal);
  assert.equal(manager.isAuthorized(), true);
  const retry = [...timers.pending].find((timer) => timer.delay < 1000);
  assert.equal(retry.delay, 500);
  now += 501;
  assert.equal(manager.isAuthorized(), false);
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(state.value.deviceId, 'd');
  await timers.run(retry);
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(manager.getAccessToken(), '');
});

test('renewal respects Retry-After even when the token expires before retry', async (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const timers = createTimers();
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd' },
    timers,
    verifyExpiresIn: () => '1s',
  });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  let attempts = 0;
  remote.challenge = async () => {
    attempts += 1;
    throw new RemoteLicenseError('HTTP_429', 'slow down', {
      status: 429,
      retryable: true,
      retryAfterMs: 60000,
    });
  };
  now += 500;
  await timers.run([...timers.pending].find((timer) => timer.delay === 500));
  assert.ok([...timers.pending].some((timer) => timer.delay === 60000));
  now += 501;
  assert.equal(manager.getSnapshot().state, LicenseState.NEEDS_CONNECTION);
  await manager.resume();
  await assert.rejects(manager.syncSongs([]));
  assert.equal(attempts, 1, 'resume and an expired protected call must respect the wait');
});

test('renewal waits an oversized Retry-After in cancellable native timer chunks', async (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const maxDelay = 2 ** 31 - 1;
  const timers = createTimers();
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd' },
    timers,
  });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  let attempts = 0;
  remote.challenge = async () => {
    attempts += 1;
    throw new RemoteLicenseError('HTTP_429', 'slow down', {
      status: 429,
      retryable: true,
      retryAfterMs: maxDelay + 500,
    });
  };
  await timers.run([...timers.pending].find((timer) => timer.delay > 150000));
  const firstChunk = [...timers.pending].find((timer) => timer.delay > 150000);
  assert.ok(firstChunk);
  assert.ok(firstChunk.delay <= maxDelay);
  now += firstChunk.delay;
  await timers.run(firstChunk);
  const remaining = maxDelay + 500 - firstChunk.delay;
  const finalChunk = [...timers.pending].find((timer) => timer.delay === remaining);
  assert.ok(finalChunk);
  assert.equal(attempts, 1);
  await manager.resume();
  assert.equal(attempts, 1);
  manager.dispose();
  now += remaining;
  await timers.run(finalChunk);
  assert.equal(attempts, 1, 'a delayed callback cannot renew after disposal');
});
