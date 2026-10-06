'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const data = (cursor = 0) => ({ version: 1, projection: 'receipt', data: {
  danmaku: { epoch: 'connection', nextCursor: cursor, events: [{ id: cursor }] },
} });

async function fixture(t, { autoOutput = false, version = 1, projection = 'receipt' } = {}) {
  let now = 0;
  let serial = 0;
  const timers = new Map();
  const outputs = [];
  const events = [];
  const state = { version, projection, updates: [], revocations: 0, disconnects: 0, errors: 0, autoOutput };
  const renderer = {
    getVersion: () => state.version,
    getProjection: () => state.projection,
    update: (value) => state.updates.push(value),
    revoke() { state.revocations += 1; state.version = 0; state.projection = ''; },
    disconnect() { state.disconnects += 1; },
  };
  function reply(request, value = data(), status = 200) {
    request.resolve({ status, ok: status >= 200 && status < 300, json: async () => ({ ok: status === 200, data: value }) });
  }
  const { createSceneSource } = await loadModuleExports(path.resolve(__dirname, '../../public/js/overlays/scene-source.js'), {
    URLSearchParams, AbortController, TextDecoder, performance: { now: () => now },
    setTimeout(callback, delay) { const id = ++serial; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch(url, options) {
      const request = { url: new URL(url, 'http://synthetic.test'), options, at: now };
      const promise = new Promise((resolve, reject) => { Object.assign(request, { resolve, reject }); });
      const output = request.url.pathname === '/api/scene/output';
      (output ? outputs : events).push(request);
      if (output && state.autoOutput) reply(request, data(outputs.length));
      return promise;
    },
  });
  const source = createSceneSource({ sceneId: 'scene', itemId: 'one-item', token: 'synthetic-secret', renderer,
    onError() { state.errors += 1; } });
  async function advance(duration) {
    const end = now + duration;
    let runs = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++runs < 1000, 'Timers must not form a busy loop.');
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    now = end;
    await flush();
  }
  function stream(request = events.at(-1)) {
    let controller;
    const connection = { cancelled: false,
      send(text) { controller.enqueue(new TextEncoder().encode(text)); },
      end() { controller.close(); },
    };
    const body = new ReadableStream({ start(value) { controller = value; }, cancel() { connection.cancelled = true; } });
    request.resolve({ status: 200, ok: true, headers: new Headers({ 'Content-Type': 'text/event-stream; charset=utf-8' }), body });
    return connection;
  }
  t.after(async () => { source.dispose(); await flush(); assert.equal(timers.size, 0, 'Disposal clears every owned timer.'); });
  source.start();
  await flush();
  return { source, state, outputs, events, reply, advance, stream, timers,
    commit(nextVersion, nextProjection) { state.version = nextVersion; state.projection = nextProjection; source.refreshSubscription(); } };
}

test('scene notifications parse chunks and CRLF, coalesce during reads and preserve event cursors', async (t) => {
  const f = await fixture(t);
  for (const request of [...f.outputs, ...f.events]) {
    assert.equal(request.url.searchParams.get('id'), 'scene');
    assert.equal(request.url.searchParams.get('item'), 'one-item');
    assert.equal(request.url.searchParams.get('version'), '1');
    assert.equal(request.url.searchParams.get('projection'), 'receipt');
    assert.equal(request.url.href.includes('synthetic-secret'), false);
    assert.equal(request.options.headers.Authorization, 'Bearer synthetic-secret');
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.cache, 'no-store');
  }
  assert.equal(f.events[0].url.searchParams.has('epoch'), false);
  assert.equal(f.events[0].url.searchParams.has('cursor'), false);
  const stream = f.stream();
  stream.send('da');
  f.reply(f.outputs[0], data(5));
  await flush();
  stream.send('ta: ready\r');
  await flush();
  stream.send('\n\r\n: data: revoked\r\n\r\n');
  await flush();
  await f.advance(99);
  assert.equal(f.outputs.length, 1);
  await f.advance(1);
  assert.equal(f.outputs.length, 2);
  stream.send('data: change\n\n'.repeat(20));
  await flush();
  await f.advance(50);
  assert.equal(f.outputs.length, 2, 'Notifications only mark the unfinished read dirty.');
  f.reply(f.outputs[1], data(7));
  await flush();
  await f.advance(49);
  assert.equal(f.outputs.length, 2);
  await f.advance(1);
  assert.equal(f.outputs.length, 3);
  assert.deepEqual(f.outputs.map((request) => request.at), [0, 100, 200]);
  assert.equal(f.outputs[2].url.searchParams.get('epoch'), 'connection');
  assert.equal(f.outputs[2].url.searchParams.get('cursor'), '7');
  f.reply(f.outputs[2], data(8));
  await flush();
  for (let index = 0; index < 4; index += 1) {
    await f.advance(1000);
    stream.send(': heartbeat\r\n\r\n');
    await flush();
  }
  await f.advance(999);
  assert.equal(f.outputs.length, 3, 'Healthy notifications replace idle 750ms polling.');
  await f.advance(1);
  assert.equal(f.outputs.length, 4, 'A quiet healthy stream still gets a five-second check.');
  assert.equal(f.outputs[3].url.searchParams.get('cursor'), '8');
  assert.deepEqual(f.state.updates.map((value) => value.data.danmaku.events[0].id), [5, 7, 8]);
  assert.equal(f.state.revocations, 0);
});

test('unavailable or saturated notification routes preserve healthy legacy output and 750ms fallback', async (t) => {
  for (const status of [401, 403, 404, 429, 503]) await t.test(`HTTP ${status}`, async (t) => {
    const f = await fixture(t, { autoOutput: true });
    f.events[0].resolve({ status, ok: false, headers: new Headers(), body: null });
    await flush();
    await f.advance(749);
    assert.equal(f.outputs.length, 1);
    await f.advance(1);
    assert.equal(f.outputs.length, 2);
    assert.equal(f.events.length, 2);
    assert.equal(f.state.revocations, 0);
    assert.equal(f.state.disconnects, 0);
    assert.equal(f.state.errors, 0);
    assert.equal(f.state.updates.length, 2);
  });
});

test('output failures disconnect once and retry after 750ms without tearing down working notifications', async (t) => {
  const f = await fixture(t, { autoOutput: true });
  const stream = f.stream(); stream.send('data: ready\n\n'); await flush();
  await f.advance(100);
  f.state.autoOutput = false;
  stream.send('data: change\n\n'); await flush();
  await f.advance(100);
  f.reply(f.outputs[2], null, 503); await flush();
  assert.equal(f.state.disconnects, 1);
  assert.equal(f.state.errors, 1);
  assert.equal(f.state.revocations, 0);
  assert.equal(stream.cancelled, false);
  stream.send('data: change\n\n'); await flush();
  await f.advance(749);
  assert.equal(f.outputs.length, 3);
  await f.advance(1);
  assert.equal(f.outputs.length, 4);
  assert.equal(f.outputs[3].url.searchParams.get('cursor'), '2');
  f.reply(f.outputs[3], data(3)); await flush();
  assert.equal(f.state.updates.length, 3);
  assert.equal(f.state.disconnects, 1);
});

test('closed streams fall back independently and reconnect with bounded exponential delays', async (t) => {
  const f = await fixture(t, { autoOutput: true });
  const stream = f.stream(); stream.send('data: ready\n\n'); await flush();
  await f.advance(100);
  stream.end(); await flush();
  let previous = 100;
  for (const delay of [750, 1500, 3000, 6000, 12000, 15000, 15000]) {
    const count = f.events.length;
    await f.advance(delay - 1);
    assert.equal(f.events.length, count);
    await f.advance(1);
    assert.equal(f.events.at(-1).at - previous, delay);
    previous = f.events.at(-1).at;
    f.events.at(-1).resolve({ status: 429, ok: false, headers: new Headers(), body: null });
    await flush();
  }
  assert.ok(f.outputs.length > f.events.length, 'A stream backoff never occupies the output request slot.');
  assert.equal(f.state.disconnects, 0);
  assert.equal(f.state.revocations, 0);
});

test('stream connection and heartbeat deadlines cancel hung readers while polling continues', async (t) => {
  await t.test('headers never arrive', async (t) => {
    const f = await fixture(t, { autoOutput: true });
    await f.advance(7999);
    assert.equal(f.events[0].options.signal.aborted, false);
    await f.advance(1);
    assert.equal(f.events[0].options.signal.aborted, true);
    const late = f.stream(f.events[0]);
    late.send('data: revoked\n\n'); await flush();
    assert.equal(late.cancelled, true);
    assert.equal(f.state.revocations, 0);
    await f.advance(750);
    assert.equal(f.events.length, 2);
  });
  await t.test('heartbeat stops after ready', async (t) => {
    const f = await fixture(t, { autoOutput: true });
    const stream = f.stream(); stream.send('data: ready\n\n'); await flush();
    await f.advance(4999);
    assert.equal(stream.cancelled, false);
    await f.advance(1);
    assert.equal(stream.cancelled, true);
    assert.equal(f.events[0].options.signal.aborted, true);
    await f.advance(750);
    assert.equal(f.events.length, 2);
    assert.equal(f.state.disconnects, 0);
  });
});

test('oversized partial lines and events are bounded and recover through polling', async (t) => {
  for (const text of ['x'.repeat(4097), `data: ${'x'.repeat(2100)}\ndata: ${'y'.repeat(2100)}\n`]) {
    await t.test(text.includes('\n') ? 'multi-line event' : 'partial line', async (t) => {
      const f = await fixture(t, { autoOutput: true });
      const stream = f.stream(); stream.send(text); await flush();
      assert.equal(stream.cancelled, true);
      await f.advance(750);
      assert.equal(f.outputs.length, 2);
      assert.equal(f.events.length, 2);
      assert.equal(f.state.revocations, 0);
    });
  }
});

test('subscriptions follow committed version and projection, retaining old receipts during preparation failures', async (t) => {
  const f = await fixture(t, { projection: 'active-receipt' });
  const stream = f.stream(); stream.send('data: ready\n\n'); await flush();
  f.reply(f.outputs[0], { ...data(1), version: 2, projection: 'preparing-receipt', document: {} }); await flush();
  f.source.refreshSubscription();
  assert.equal(f.events.length, 1, 'Receiving a new document does not imply the renderer committed it.');
  assert.equal(f.events[0].url.searchParams.get('projection'), 'active-receipt');
  await f.advance(100);
  assert.equal(f.outputs[1].url.searchParams.get('version'), '1');
  assert.equal(f.outputs[1].url.searchParams.get('projection'), 'active-receipt');
  f.commit(2, 'preparing-receipt');
  assert.equal(stream.cancelled, true);
  assert.equal(f.events[0].options.signal.aborted, true);
  assert.equal(f.events.length, 2);
  assert.equal(f.events[1].url.searchParams.get('version'), '2');
  assert.equal(f.events[1].url.searchParams.get('projection'), 'preparing-receipt');
  f.source.refreshSubscription();
  assert.equal(f.events.length, 2);
  f.commit(2, 'replacement-receipt');
  assert.equal(f.events.length, 3, 'Receipt changes refresh the stream even at the same version.');
  assert.equal(f.outputs.length, 2, 'Refreshing a subscription never starts a parallel output read.');
});

test('explicit revocation aborts an unfinished output body and discards its late data', async (t) => {
  const f = await fixture(t);
  const stream = f.stream(); stream.send('data: ready\n\n'); await flush();
  let resolveBody;
  f.outputs[0].resolve({ status: 200, ok: true, json: () => new Promise((resolve) => { resolveBody = resolve; }) });
  await flush();
  stream.send('data: revoked\n\n'); await flush();
  assert.equal(f.state.revocations, 1);
  assert.equal(f.state.disconnects, 1);
  assert.equal(f.outputs[0].options.signal.aborted, true);
  assert.equal(stream.cancelled, true);
  resolveBody({ ok: true, data: data(99) }); await flush();
  assert.equal(f.state.updates.length, 0);
  await f.advance(750);
  assert.equal(f.outputs.length, 2);
  assert.equal(f.outputs[1].url.searchParams.get('version'), '0');
  assert.equal(f.outputs[1].url.searchParams.get('cursor'), '0', 'Revoked late data cannot advance the delivery cursor.');
});

test('authoritative output authorization failures revoke output and cancel the subscription', async (t) => {
  for (const status of [401, 403, 404, 423]) await t.test(`HTTP ${status}`, async (t) => {
    const f = await fixture(t);
    const stream = f.stream(); stream.send('data: ready\n\n'); await flush();
    f.outputs[0].resolve({ status, ok: false, json() { throw new Error('Unauthorized bodies are not needed.'); } });
    await flush();
    assert.equal(f.state.revocations, 1);
    assert.equal(f.state.disconnects, 1);
    assert.equal(stream.cancelled, true);
    await f.advance(750);
    assert.equal(f.outputs.length, 2);
  });
});

test('output timeout and disposal ignore late responses and clear reads, stream readers and backoff timers', async (t) => {
  const f = await fixture(t);
  const stream = f.stream(); stream.send('data: ready\n\n'); await flush();
  for (let index = 0; index < 8; index += 1) {
    await f.advance(1000);
    stream.send(': heartbeat\n\n'); await flush();
  }
  assert.equal(f.outputs[0].options.signal.aborted, true);
  f.reply(f.outputs[0], data(99)); await flush();
  assert.equal(f.state.updates.length, 0);
  assert.equal(f.state.disconnects, 1);
  await f.advance(750);
  assert.equal(f.outputs.length, 2);
  stream.end(); await flush();
  f.source.dispose(); f.source.dispose();
  assert.equal(f.outputs[1].options.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  f.reply(f.outputs[1], data(100)); await flush();
  await f.advance(30000);
  assert.equal(f.outputs.length, 2);
  assert.equal(f.events.length, 1);
  assert.equal(f.state.updates.length, 0);
  assert.equal(f.state.disconnects, 1);
});
