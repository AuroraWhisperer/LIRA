'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readRoomGuardCount, createRoomGuardService } = require('../../src/bilibili/room-guard-service');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('room count query uses WBI, refreshes a rejected key once and accepts cancellation', async (t) => {
  const signer = require('../../src/bilibili/wbi-signer');
  const { BilibiliApiClient } = require('../../src/bilibili/danmaku/api-client');
  const key = { mixinKey: 'a'.repeat(32) };
  const keys = t.mock.method(signer, 'getBilibiliWbiKey', async () => key);
  const invalidate = t.mock.method(signer, 'invalidateBilibiliWbiKey', () => {});
  const api = new BilibiliApiClient('52030');
  let attempts = 0;
  t.mock.method(api, 'fetchJson', async (endpoint, value, options) => {
    const url = new URL(value);
    assert.equal(endpoint, 'room_guard_count');
    assert.equal(url.searchParams.get('room_id'), '52030');
    assert.match(url.searchParams.get('w_rid'), /^[a-f0-9]{32}$/);
    assert.ok(options.signal);
    return { response: { status: 200 }, payload: ++attempts === 1 ? { code: -352 }
      : { code: 0, data: { guard_info: { count: 1000 } } } };
  });
  const controller = new AbortController();
  assert.equal(await api.fetchRoomGuardCount({ signal: controller.signal }), 1000);
  assert.equal(keys.mock.callCount(), 2);
  assert.equal(invalidate.mock.callCount(), 1);
  controller.abort();
  await assert.rejects(api.fetchRoomGuardCount({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(attempts, 2);
});

test('room guard count uses the room total, including zero, and rejects missing or invalid data', () => {
  for (const count of [0, 999, 1000, 10000]) {
    assert.equal(readRoomGuardCount({ guard_info: { count } }), count);
    assert.equal(readRoomGuardCount({ guard_info: { count: String(count) } }), count);
  }
  for (const count of [null, undefined, '', true, -1, 1.5, Infinity, '1e3']) {
    assert.equal(readRoomGuardCount({ guard_info: { count }, guard_num: 1000 }), null);
  }
});

test('one room poller updates counts, resets on failure, and disposes its timer', async () => {
  let nextCount = 999;
  let pending;
  const updates = [];
  const service = createRoomGuardService({
    readCount: async () => { if (nextCount instanceof Error) throw nextCount; return nextCount; },
    onChange: (state) => updates.push(state),
    setTimeoutFn: (callback) => { pending = callback; return callback; },
    clearTimeoutFn: () => { pending = null; },
  });
  service.configure('https://live.bilibili.com/52030');
  await settle();
  assert.deepEqual(service.getSnapshot(), { roomId: '52030', count: 999 });
  const timer = pending;
  service.configure('52030');
  assert.equal(pending, timer);
  nextCount = 1000;
  await pending();
  assert.equal(service.getSnapshot().count, 1000);
  nextCount = new Error('offline');
  await pending();
  assert.equal(service.getSnapshot().count, null);
  assert.deepEqual(updates.map((state) => state.count), [null, 999, 1000, null]);
  service.stop();
  assert.equal(pending, null);
});

test('switching rooms and shutdown abort and ignore late results', async () => {
  const requests = [];
  const updates = [];
  const service = createRoomGuardService({
    readCount: (roomId, { signal }) => {
      const request = Promise.withResolvers();
      requests.push({ roomId, signal, ...request });
      return request.promise;
    },
    onChange: (state) => updates.push(state),
  });
  service.configure('1');
  service.configure('2');
  assert.equal(requests[0].signal.aborted, true);
  assert.deepEqual(service.getSnapshot(), { roomId: '2', count: null });
  requests[1].resolve(12);
  requests[0].resolve(1000);
  await settle();
  assert.deepEqual(service.getSnapshot(), { roomId: '2', count: 12 });
  service.configure('3');
  service.stop();
  requests[2].resolve(10000);
  await settle();
  assert.equal(requests[2].signal.aborted, true);
  assert.deepEqual(updates.at(-1), { roomId: '3', count: null });
});
