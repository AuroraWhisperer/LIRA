'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, deferred, SCOPE_A, SCOPE_B } = require('./helpers/fan-profile-controller-fixture');

test('late remote responses cannot write after a streamer switch, even when transport ignores abort', async (t) => {
  const delayed = deferred();
  let first = true;
  const f = fixture(t, {
    fetch: (input, state) => {
      if (first) {
        first = false;
        return delayed.promise;
      }
      return {
        version: 1,
        streamerId: state.streamerId,
        epoch: 'new-epoch',
        nextCursor: 2,
        events: [],
        hasMore: false,
      };
    },
  });
  const oldContext = f.invoke({ action: 'open' }).contextId;
  const oldOperation = f.controller.start();
  await Promise.resolve();
  assert.equal(f.calls.fetch.length, 1);
  const oldSignal = f.calls.fetch[0].signal;
  f.state.streamerId = 'streamer-b';
  f.state.epoch++;
  f.emit();
  assert.equal(oldSignal.aborted, true);
  assert.match(f.invoke({ action: 'list', contextId: oldContext }).error, /登录状态已变化/);
  delayed.resolve(f.page('streamer-a'));
  await oldOperation;
  await f.controller.whenIdle();
  assert.deepEqual(
    f.calls.consume.map((call) => call.scope),
    [SCOPE_B],
  );
  assert.equal(f.calls.consume[0].page.streamerId, 'streamer-b');
});

test('late remote responses are rejected when origin or authorization changes without a state event', async (t) => {
  for (const change of [
    (state) => {
      state.origin = 'https://other.example';
    },
    (state) => {
      state.authorized = false;
    },
    (state) => {
      state.epoch++;
    },
  ]) {
    const delayed = deferred();
    const f = fixture(t, { fetch: () => delayed.promise });
    const operation = f.controller.start();
    await Promise.resolve();
    change(f.state);
    delayed.resolve(f.page());
    await operation;
    assert.equal(f.calls.consume.length, 0);
    f.controller.dispose();
  }
});

test('dispose aborts in-flight work, clears retries, removes listeners and prevents late writes', async (t) => {
  const delayed = deferred();
  const f = fixture(t, { fetch: () => delayed.promise });
  const operation = f.controller.start();
  await Promise.resolve();
  const signal = f.calls.fetch[0].signal;
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(f.calls.unsubscribe, 1);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.pending.size, 0);
  delayed.resolve(f.page());
  await operation;
  assert.equal(f.calls.consume.length, 0);
  assert.equal(f.timers.pending.size, 0);
  assert.match(f.invoke({ action: 'open' }).error, /先登录/);
  f.disposeIpc();
  f.disposeIpc();
  assert.equal(f.handlers.size, 0);
});

test('legacy server 404 disables automatic facts gracefully while manual profile actions keep working', async (t) => {
  const f = fixture(t, {
    fetch: () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    },
  });
  await f.controller.start();
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.ok, true);
  assert.equal(opened.syncStatus, 'unsupported');
  assert.equal(opened.data.profiles.length, 1);
  const saved = f.invoke({ action: 'save', contextId: opened.contextId, payload: { alias: '手动资料' } });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.saved, true);
  assert.equal(f.calls.consume.length, 0);
  assert.equal(f.timers.pending.size, 1);
  const retry = f.timers.pending.values().next().value;
  assert.ok(retry.delay >= 15000);
  assert.equal(retry.unrefCalled, true);
  f.controller.dispose();
  assert.equal(f.timers.pending.size, 0);
});

test('first-use settings gate remote facts until configuration and committed cursors drive later pages', async (t) => {
  const f = fixture(t, {
    initialized: false,
    fetch: (input, state) => ({
      version: 1,
      streamerId: state.streamerId,
      epoch: 'remote-epoch',
      nextCursor: input.after + 1,
      events: [],
      hasMore: input.after < 1,
    }),
  });
  await f.controller.start();
  assert.equal(f.calls.fetch.length, 0);
  const opened = f.invoke({ action: 'open' });
  f.invoke({ action: 'configure', contextId: opened.contextId, payload: { autoCreate: true, autoUpdate: true } });
  await f.controller.whenIdle();
  assert.deepEqual(
    f.calls.fetch.map((call) => call.after),
    [0, 1],
  );
  assert.deepEqual(
    f.calls.consume.map((call) => call.page.nextCursor),
    [1, 2],
  );
  assert.equal(f.timers.pending.size, 1);
  f.timers.runNext();
  await f.controller.whenIdle();
  assert.equal(f.calls.fetch.at(-1).after, 2);
});

test('a temporary settings read failure schedules a retry and cannot poison later synchronization', async (t) => {
  const f = fixture(t);
  const execute = f.service.execute;
  let failOnce = true;
  f.service.execute = (scope, action, payload) => {
    if (action === 'settings' && failOnce) {
      failOnce = false;
      throw new Error('fictional temporary storage failure');
    }
    return execute(scope, action, payload);
  };
  await assert.doesNotReject(f.controller.start());
  assert.equal(f.calls.fetch.length, 0);
  assert.equal(f.calls.consume.length, 0);
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.ok, true);
  assert.equal(opened.syncStatus, 'offline');
  assert.equal(f.timers.pending.size, 1);
  assert.equal(f.timers.pending.values().next().value.delay, 30000);
  f.timers.runNext();
  await assert.doesNotReject(f.controller.whenIdle());
  assert.equal(f.calls.fetch.length, 1);
  assert.equal(f.calls.fetch[0].after, 0);
  assert.deepEqual(
    f.calls.consume.map(({ scope }) => scope),
    [SCOPE_A],
  );
  assert.equal(f.invoke({ action: 'list', contextId: opened.contextId }).syncStatus, 'ready');
  assert.equal(f.timers.pending.size, 1);
  assert.equal(f.timers.pending.values().next().value.delay, 15000);
});

test('a bounded ten-page pass remains syncing and the scheduled continuation resumes the committed cursor', async (t) => {
  const f = fixture(t, {
    fetch: (input, state) => ({
      version: 1,
      streamerId: state.streamerId,
      epoch: 'remote-epoch',
      after: input.after,
      nextCursor: input.after + 1,
      events: [],
      hasMore: input.after < 10,
    }),
  });
  await f.controller.start();
  assert.deepEqual(
    f.calls.fetch.map(({ after }) => after),
    Array.from({ length: 10 }, (_, index) => index),
  );
  assert.equal(f.calls.consume.length, 10);
  assert.equal(f.invoke({ action: 'open' }).syncStatus, 'syncing');
  assert.equal(f.settings.get(SCOPE_A).cursor, 10);
  assert.equal(f.timers.pending.size, 1);
  f.timers.runNext();
  await f.controller.whenIdle();
  assert.equal(f.calls.fetch.length, 11);
  assert.equal(f.calls.fetch.at(-1).after, 10);
  assert.equal(f.calls.consume.at(-1).page.nextCursor, 11);
  assert.equal(f.invoke({ action: 'open' }).syncStatus, 'ready');
});
