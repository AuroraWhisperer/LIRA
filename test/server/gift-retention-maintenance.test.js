'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGiftRetentionMaintenance } = require('../../src/server/gift-retention-maintenance');

function fixture(t, options = {}) {
  const pending = new Set();
  const calls = [];
  const errors = [];
  const owner = createGiftRetentionMaintenance({
    canRun: () => true,
    runBatch: sourceId => { calls.push(sourceId); return { hasMore: false }; },
    onError: (sourceId, error) => errors.push([sourceId, error.code]),
    ...options,
    timers: {
      setTimeout(callback, delay) { const timer = { callback, delay }; pending.add(timer); return timer; },
      clearTimeout(timer) { pending.delete(timer); },
    },
  });
  t.after(() => owner.stop());
  function tick() {
    assert.equal(pending.size, 1);
    const timer = [...pending][0];
    pending.delete(timer);
    timer.callback();
    return timer.delay;
  }
  return { owner, pending, calls, errors, tick };
}

test('maintenance waits for desktop readiness, coalesces requests and yields between batches', (t) => {
  const calls = [];
  const f = fixture(t, { runBatch(sourceId) { calls.push(sourceId); return { hasMore: calls.length < 3 }; } });
  f.owner.request(1);
  f.owner.request(1);
  assert.equal(f.pending.size, 0);
  f.owner.start();
  f.owner.start();
  f.owner.request(1);
  assert.equal(f.tick(), 25);
  assert.deepEqual(calls, [1], 'continuations never execute in the same turn');
  f.owner.request(1);
  f.owner.request(2);
  f.tick();
  f.tick();
  f.tick();
  assert.deepEqual(calls, [1, 1, 2, 1]);
  assert.equal(f.pending.size, 0);
});

test('dynamic source and settings checks fence queued work; failed batches back off and stop cancels retries', async (t) => {
  let enabled = true;
  let activeSource = 1;
  let fail = true;
  const calls = [];
  const f = fixture(t, { canRun: source => enabled && activeSource === source,
    runBatch(source) { calls.push(source); if (fail) throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' }); return {}; } });
  f.owner.start();
  f.owner.request(1);
  activeSource = 2;
  f.tick();
  f.owner.request(2);
  enabled = false;
  f.tick();
  assert.deepEqual(calls, []);
  enabled = true;
  f.owner.request(2);
  f.tick();
  assert.deepEqual(f.errors, [[2, 'SQLITE_BUSY']]);
  assert.equal([...f.pending][0].delay, 300000);
  fail = false;
  f.tick();
  assert.deepEqual(calls, [2, 2]);
  f.owner.request(2);
  const staleCallback = [...f.pending][0].callback;
  await f.owner.stop();
  staleCallback();
  f.owner.request(2);
  assert.equal(f.pending.size, 0);
  assert.deepEqual(calls, [2, 2]);
  assert.throws(() => f.owner.runLocal(() => {}), /STOPPED/);
});
