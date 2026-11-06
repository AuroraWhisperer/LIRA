'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPreviewPollBatch } = require('../../public/js/admin/component-preview-poll-batch.js');

const tick = () => new Promise(setImmediate);
const entry = id => ({ action: 'read', id, token: `synthetic-${id}`, attachmentId: `page-${id}`,
  stateRevision: 1, displayRevision: 2, ack: 0, waitMs: 20000 });

function fixture(t) {
  const calls = [];
  const batch = createPreviewPollBatch({ send(body, signal) {
    return new Promise((resolve, reject) => {
      calls.push({ body, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  t.after(() => batch.dispose());
  return { batch, calls };
}

test('one idle batch carries every component capability and routes updates by session identity', async t => {
  const { batch, calls } = fixture(t);
  const ids = ['clock', 'queue', 'danmaku', 'overtime', 'canvas'];
  const waiting = ids.map(id => batch.request(entry(id)));
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, 'read-batch');
  assert.equal(calls[0].body.waitMs, 20000);
  assert.deepEqual(calls[0].body.entries.map(value => [value.id, value.token, value.attachmentId, value.waitMs]),
    ids.map(id => [id, `synthetic-${id}`, `page-${id}`, undefined]));
  calls[0].resolve({ updates: [...ids].reverse().map(id => ({ id, ack: ids.indexOf(id) + 1 })), waitMs: 20000 });
  const updates = await Promise.all(waiting);
  assert.deepEqual(updates.map(update => [update.ack, update.waitMs]), ids.map((_, index) => [index + 1, 20000]));
});

test('joining and cancelling a pending component regroup the wait without failing other components', async t => {
  const { batch, calls } = fixture(t);
  const cancelFirst = new AbortController();
  const first = batch.request(entry('first'), { signal: cancelFirst.signal });
  const cancelled = assert.rejects(first, error => error === cancelFirst.signal.reason);
  await tick();
  let settled = false;
  const second = batch.request(entry('second')).then(value => { settled = true; return value; });
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls[1].body.entries.map(value => value.id), ['first', 'second']);
  cancelFirst.abort(new Error('first component closed'));
  await cancelled;
  await tick();
  assert.equal(calls.length, 3);
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(settled, false);
  assert.deepEqual(calls[2].body.entries.map(value => value.id), ['second']);
  calls[0].resolve({ updates: [{ id: 'first', ack: 99 }], waitMs: 20000 });
  calls[1].resolve({ updates: [{ id: 'second', ack: 99 }], waitMs: 20000 });
  calls[2].resolve({ updates: [{ id: 'second', ack: 3 }], waitMs: 20000 });
  assert.equal((await second).ack, 3);
});

test('a real transport failure reaches each connection so its existing retry policy can run', async t => {
  const { batch, calls } = fixture(t);
  const failure = Object.assign(new Error('temporary failure'), { status: 503 });
  const waiting = ['clock', 'canvas'].map(id => assert.rejects(batch.request(entry(id)), error => error === failure));
  await tick();
  calls[0].reject(failure);
  await Promise.all(waiting);
  const next = batch.request(entry('canvas'));
  await tick();
  assert.equal(calls.length, 2);
  calls[1].resolve({ updates: [{ id: 'canvas', ack: 1 }], waitMs: 20000 });
  assert.equal((await next).ack, 1);
});

test('an incomplete batch response fails every pending read instead of committing an empty update', async t => {
  const { batch, calls } = fixture(t);
  const waiting = ['clock', 'canvas'].map(id => assert.rejects(batch.request(entry(id))));
  await tick();
  calls[0].resolve({ updates: [{ id: 'clock', ack: 1 }], waitMs: 20000 });
  await Promise.all(waiting);
});

test('disposing a window aborts its shared wait and rejects all pending and future requests', async t => {
  const { batch, calls } = fixture(t);
  const waiting = ['clock', 'canvas'].map(id => assert.rejects(batch.request(entry(id))));
  await tick();
  batch.dispose();
  await Promise.all(waiting);
  assert.equal(calls[0].signal.aborted, true);
  await assert.rejects(batch.request(entry('later')));
  await tick();
  assert.equal(calls.length, 1);
});
