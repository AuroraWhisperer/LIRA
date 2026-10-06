'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createSceneOutputEvents } = require('../../src/server/scene-output-events');

class Response extends EventEmitter {
  constructor() {
    super();
    this.chunks = [];
    this.destroyed = false;
    this.writableEnded = false;
    this.acceptWrite = true;
  }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; }
  write(text) { this.chunks.push(text); return this.acceptWrite; }
  end() { this.writableEnded = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
  messages() { return this.chunks.filter((text) => text.startsWith('data:')); }
}

function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const state = { binding: 'owner:1:capability', version: 1, status: 200,
    types: ['queue'], accessError: null, reads: 0, statusReads: 0 };
  const events = createSceneOutputEvents({ getAccess(input) {
    state.reads += 1;
    if (state.accessError) throw state.accessError;
    return { binding: `${state.binding}:${input.id.toLowerCase()}:${input.item || ''}`,
      version: state.version, types: [...state.types] };
  }, ...options });
  t.after(() => events.dispose());
  const getStatus = () => { state.statusReads += 1; return state.status; };
  return { events, state, getStatus,
    open(input = { id: 'scene-a', token: 'private-token' }, res = new Response()) {
      const result = events.open(res, input, getStatus);
      assert.equal(result, undefined, 'connection registration must not wait for the response to close');
      return res;
    } };
}

test('scene event streams start immediately with fixed notifications and coalesce relevant changes', (t) => {
  const { events, state, open } = fixture(t);
  const res = open();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.messages(), ['data: ready\n\n']);
  events.notify({ types: ['lyrics'] });
  t.mock.timers.tick(40);
  assert.equal(state.reads, 1, 'irrelevant events do not read publication state');
  for (let i = 0; i < 50; i++) events.notify({ types: ['queue'] });
  t.mock.timers.tick(39);
  assert.equal(res.messages().length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(res.messages(), ['data: ready\n\n', 'data: change\n\n']);
  assert.equal(state.reads, 2, 'one access check per coalesced notification');
  assert.equal(state.statusReads, 2);
  t.mock.timers.tick(960);
  assert.equal(res.chunks.at(-1), ': heartbeat\n\n');
  assert.equal(res.messages().length, 2, 'heartbeats do not trigger data reads');
  assert.doesNotMatch(res.chunks.join(''), /queue|scene-a|owner|capability|private-token/);
});

test('scene events recheck types at delivery and retain all coalesced type reasons', (t) => {
  const { events, state, open } = fixture(t);
  const res = open();
  events.notify({ types: ['queue'] });
  state.types = ['lyrics'];
  t.mock.timers.tick(40);
  assert.equal(res.messages().length, 1, 'removed types cannot cause a data notification');
  state.types = ['queue', 'lyrics'];
  t.mock.timers.tick(960);
  events.notify({ types: ['queue'] });
  events.notify({ types: ['lyrics'] });
  state.types = ['lyrics'];
  t.mock.timers.tick(40);
  assert.equal(res.messages().at(-1), 'data: change\n\n');
});

test('scene id notifications bypass type filtering, match normalized ids and isolate other scenes', (t) => {
  const { events, open } = fixture(t);
  const one = open({ id: 'SCENE-A', token: 'private' });
  const two = open({ id: 'scene-b', token: 'private' });
  events.notify({ id: 'scene-a', types: ['browser'] });
  t.mock.timers.tick(40);
  assert.equal(one.messages().at(-1), 'data: change\n\n');
  assert.equal(two.messages().length, 1);
  events.notify();
  t.mock.timers.tick(40);
  assert.equal(one.messages().length, 3);
  assert.equal(two.messages().length, 2);
});

test('heartbeat detects publication changes even when an explicit notification is missed', (t) => {
  const { events, state, open } = fixture(t);
  const res = open();
  t.mock.timers.tick(980);
  events.notify({ types: ['queue'] });
  state.version = 2;
  t.mock.timers.tick(20);
  assert.equal(res.messages().at(-1), 'data: change\n\n');
  t.mock.timers.tick(20);
  assert.equal(res.messages().length, 2, 'the heartbeat also consumes an already pending change');
  t.mock.timers.tick(980);
  assert.equal(res.messages().length, 2, 'unchanged versions only receive comments');
});

test('only authenticated streams consume slots and a closed connection releases its slot immediately', (t) => {
  const { events, state, getStatus, open } = fixture(t);
  const responses = Array.from({ length: 4 }, () => open());
  const rejected = new Response();
  state.accessError = Object.assign(new Error('secret detail'), { statusCode: 403 });
  assert.throws(() => events.open(rejected, { id: 'invalid' }, getStatus), { statusCode: 403 });
  state.accessError = null;
  assert.throws(() => events.open(rejected, { id: 'scene-b' }, getStatus), { statusCode: 429 });
  assert.equal(rejected.statusCode, undefined);
  assert.equal(rejected.listenerCount('close'), 0);
  responses[0].destroy();
  assert.equal(responses[0].listenerCount('close'), 0);
  assert.equal(responses[0].listenerCount('error'), 0);
  assert.equal(open().messages()[0], 'data: ready\n\n');
});

for (const binding of ['another-owner:1:capability', 'owner:2:capability', 'owner:1:rotated']) {
  test(`scene streams revoke when their immutable binding changes to ${binding}`, (t) => {
    const { events, state, open } = fixture(t);
    const res = open();
    state.binding = binding;
    events.notify({ id: 'scene-a' });
    t.mock.timers.tick(40);
    assert.deepEqual(res.messages(), ['data: ready\n\n', 'data: revoked\n\n']);
    assert.equal(res.writableEnded, true);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
  });
}

for (const statusCode of [401, 403, 404, 409]) {
  test(`scene streams revoke when access revalidation returns ${statusCode}`, (t) => {
    const { state, open } = fixture(t);
    const res = open();
    state.accessError = Object.assign(new Error('private failure detail'), { statusCode });
    t.mock.timers.tick(1000);
    assert.deepEqual(res.messages(), ['data: ready\n\n', 'data: revoked\n\n']);
    assert.equal(res.writableEnded, true);
  });
}

test('live server license state revokes an already open stream without waiting for another request', (t) => {
  const { events, state, open } = fixture(t);
  const res = open();
  state.status = 423;
  events.notify({ types: ['queue'] });
  t.mock.timers.tick(40);
  assert.deepEqual(res.messages(), ['data: ready\n\n', 'data: revoked\n\n']);
  assert.equal(res.writableEnded, true);
  assert.equal(state.reads, 1, 'license rejection precedes storage reads');
});

test('shutdown and internal errors close streams for polling fallback without claiming revocation', (t) => {
  const { state, open } = fixture(t);
  const shutdown = open();
  state.status = 503;
  t.mock.timers.tick(1000);
  assert.deepEqual(shutdown.messages(), ['data: ready\n\n']);
  assert.equal(shutdown.writableEnded, true);
  state.status = 200;
  const failure = open();
  state.accessError = new Error('database contains a private path');
  assert.doesNotThrow(() => t.mock.timers.tick(1000));
  assert.deepEqual(failure.messages(), ['data: ready\n\n']);
  assert.equal(failure.writableEnded, true);
});

test('initial status and access errors are safe and never allocate response listeners', (t) => {
  const { events, state, getStatus } = fixture(t);
  const res = new Response();
  for (const status of [423, 503]) {
    state.status = status;
    assert.throws(() => events.open(res, { id: 'scene-a' }, getStatus), { statusCode: status });
  }
  state.status = 200;
  state.accessError = new Error('secret database path');
  assert.throws(() => events.open(res, { id: 'scene-a' }, getStatus), (error) =>
    error.statusCode === 503 && error.code === 'SCENE_EVENTS_UNAVAILABLE' && !error.message.includes('secret'));
  assert.equal(res.chunks.length, 0);
  assert.equal(res.eventNames().length, 0);
  t.mock.timers.tick(10000);
  assert.equal(state.reads, 1);
});

for (const failure of ['backpressure', 'write-error', 'response-error']) {
  test(`${failure} immediately closes and releases a scene stream`, (t) => {
    const { events, open } = fixture(t, { maxStreams: 1 });
    const res = open();
    if (failure === 'backpressure') res.acceptWrite = false;
    if (failure === 'write-error') res.write = () => { throw new Error('write failed'); };
    events.notify({ types: ['queue'] });
    if (failure === 'response-error') res.emit('error', new Error('socket failed'));
    assert.doesNotThrow(() => t.mock.timers.tick(40));
    assert.equal(res.destroyed, true);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
    assert.equal(open().messages()[0], 'data: ready\n\n');
  });
}

test('initial write failure releases the stream and all timers', (t) => {
  const { events, state, getStatus, open } = fixture(t, { maxStreams: 1 });
  const res = new Response();
  res.acceptWrite = false;
  events.open(res, { id: 'scene-a' }, getStatus);
  assert.equal(res.destroyed, true);
  t.mock.timers.tick(10000);
  assert.equal(state.reads, 1);
  assert.equal(open().messages()[0], 'data: ready\n\n');
});

test('client close and disposal stop pending changes, idle access checks and every owned listener', (t) => {
  const { events, state, getStatus, open } = fixture(t);
  const first = open();
  events.notify({ types: ['queue'] });
  first.destroy();
  const readsAfterClose = state.reads;
  t.mock.timers.tick(10000);
  assert.equal(state.reads, readsAfterClose);
  assert.equal(first.messages().length, 1);
  const second = open();
  const third = open();
  events.notify();
  events.dispose();
  events.dispose();
  const readsAfterDispose = state.reads;
  t.mock.timers.tick(10000);
  assert.equal(state.reads, readsAfterDispose);
  for (const res of [first, second, third]) {
    assert.equal(res.destroyed, true);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
    assert.equal(res.messages().length, 1);
  }
  assert.doesNotThrow(() => events.notify());
  assert.throws(() => events.open(new Response(), { id: 'scene-a' }, getStatus), { statusCode: 503 });
});

test('a stream uses the original authorization input throughout its lifetime', (t) => {
  const { events, state, getStatus } = fixture(t);
  const input = { id: 'scene-a', item: 'original-item', token: 'private' };
  const res = new Response();
  events.open(res, input, getStatus);
  input.item = 'another-item';
  input.id = 'scene-b';
  t.mock.timers.tick(1000);
  assert.equal(res.writableEnded, false);
  assert.equal(state.reads, 2);
  assert.deepEqual(res.messages(), ['data: ready\n\n']);
});
