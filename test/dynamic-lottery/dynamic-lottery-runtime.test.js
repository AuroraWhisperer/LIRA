'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFixture, settle } = require('../helpers/dynamic-lottery-auth-fixture');
const { openLotteryDatabase } = require('../helpers/dynamic-lottery-fixture');
const { createDynamicLotteryRuntime } = require('../../src/server/dynamic-lottery-runtime');

const INPUT = { url: 'https://t.bilibili.com/888', requestId: 'runtime-request-0001',
  winnerCount: 1, requireLike: false, requireRepost: false, requireFollow: false };

async function createRuntimeFixture(t, fetchImpl) {
  const f = createFixture(t);
  await f.signIn();
  const db = openLotteryDatabase();
  const runtime = createDynamicLotteryRuntime({ db, auth: f.auth, fetchImpl });
  t.after(async () => { await runtime.dispose(); db.close(); });
  return { ...f, runtime };
}

test('switching LIRA accounts cancels lottery retry backoff before starting the next account job', { timeout: 5_000 }, async (t) => {
  const started = Promise.withResolvers();
  let calls = 0;
  const f = await createRuntimeFixture(t, async (_url, { signal }) => {
    calls += 1;
    started.resolve(signal);
    throw new TypeError('synthetic network failure');
  });
  await f.runtime.createTask(INPUT);
  const previousSignal = await started.promise;
  await settle(); // The failed request has entered its retry delay.
  f.license.streamerId = 'streamer-b';
  f.stateChanges.emit('state');
  const nextJob = f.runtime.createTask({ ...INPUT, requestId: 'runtime-request-0002' });
  const competing = assert.rejects(f.runtime.createTask({ ...INPUT, requestId: 'runtime-request-0003' }),
    { code: 'LOTTERY_BUSY' });
  const next = await nextJob;
  await competing;
  assert.equal(previousSignal.aborted, true);
  assert.equal(next.job.kind, 'collect');
  assert.equal(calls, 1, 'no old request is retried after account invalidation');
  assert.equal(f.runtime.getState().tasks.length, 0, 'cancelled inspection stores no activity for the new account');
});

test('a waiting lottery request cannot cross dedicated logout and relogin under the same LIRA identity', async (t) => {
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  let calls = 0;
  const f = await createRuntimeFixture(t, (_url, { signal }) => {
    calls += 1;
    started.resolve(signal);
    return response.promise;
  });
  await f.runtime.createTask(INPUT);
  const previousSignal = await started.promise;
  try {
    const logout = f.auth.logout();
    const rejected = assert.rejects(async () => f.runtime.createTask({ ...INPUT, requestId: 'runtime-request-0002' }),
      { code: 'LOTTERY_SESSION_CHANGED' });
    await logout;
    await f.signIn();
    response.reject(previousSignal.reason);
    await rejected;
    assert.equal(calls, 1, 'the waiting request never starts under the replacement login');
    assert.equal(f.runtime.getState().job, null);
    const fresh = await f.runtime.createTask({ ...INPUT, requestId: 'runtime-request-0003' });
    assert.equal(fresh.job.kind, 'collect');
  } finally {
    response.reject(new Error('test finished'));
  }
});
