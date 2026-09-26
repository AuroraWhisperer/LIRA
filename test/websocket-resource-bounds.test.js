'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createWebSocketHub } = require('../src/server/ws');

class CountingSocket extends EventEmitter {
  constructor() {
    super();
    this.writableLength = 0;
    this.destroyed = false;
    this.frames = 0;
  }

  write(chunk) {
    if (Buffer.isBuffer(chunk)) this.frames += 1;
    return true;
  }

  end() {
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
}

function frame(payload, opcode = 1, fin = true) {
  const body = Buffer.from(payload);
  const headerBytes = body.length < 126 ? 2 : 4;
  const result = Buffer.alloc(headerBytes + 4 + body.length);
  result[0] = (fin ? 0x80 : 0) | opcode;
  result[1] = 0x80 | (headerBytes === 2 ? body.length : 126);
  if (headerBytes === 4) result.writeUInt16BE(body.length, 2);
  // A zero mask is valid; the payload still goes through server unmasking.
  body.copy(result, headerBytes + 4);
  return result;
}

function openSocket(hub, context) {
  const socket = new CountingSocket();
  hub.handleUpgrade(context, {
    url: '/ws',
    headers: {
      authorization: 'Bearer synthetic-resource-token',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    },
  }, socket);
  return socket;
}

function fixture(t) {
  const hub = createWebSocketHub();
  const context = {
    sessionToken: 'synthetic-resource-token',
    state: { sockets: new Set() },
    getState: () => ({}),
  };
  const socket = openSocket(hub, context);
  t.after(() => hub.stop());
  return { hub, context, socket };
}

function countCopies(t, operation) {
  let bytes = 0;
  const concat = Buffer.concat;
  const copy = Buffer.prototype.copy;
  const concatMock = t.mock.method(Buffer, 'concat', function (chunks, length) {
    bytes += length ?? chunks.reduce((total, chunk) => total + chunk.length, 0);
    return concat.call(this, chunks, length);
  });
  const copyMock = t.mock.method(Buffer.prototype, 'copy', function (...args) {
    const copied = copy.apply(this, args);
    bytes += copied;
    return copied;
  });
  try {
    operation();
    return bytes;
  } finally {
    concatMock.mock.restore();
    copyMock.mock.restore();
  }
}

test('one-byte WebSocket continuations require linear copying', (t) => {
  const { socket } = fixture(t);
  const first = frame('a', 1, false);
  const continuation = frame('a', 0, false);
  const last = frame('a', 0);
  const fragments = 8192;
  const copiedBytes = countCopies(t, () => {
    socket.emit('data', first);
    for (let index = 1; index < fragments - 1; index += 1) socket.emit('data', continuation);
    socket.emit('data', last);
  });
  assert.equal(socket.destroyed, false);
  assert.equal(socket._wsFragment, null);
  assert.ok(copiedBytes <= fragments * 8, `${copiedBytes} copied bytes for ${fragments} payload bytes`);
  t.diagnostic(`${fragments} payload bytes: ${copiedBytes} buffer-copy bytes`);
});

test('a WebSocket frame arriving one byte at a time requires linear copying', (t) => {
  const { socket } = fixture(t);
  const input = frame(Buffer.alloc(8192, 0x61));
  const copiedBytes = countCopies(t, () => {
    for (let index = 0; index < input.length; index += 1) socket.emit('data', input.subarray(index, index + 1));
  });
  assert.equal(socket.destroyed, false);
  assert.equal(socket._wsBuffer.length, 0);
  assert.ok(copiedBytes <= input.length * 8, `${copiedBytes} copied bytes for ${input.length} wire bytes`);
  t.diagnostic(`${input.length} wire bytes: ${copiedBytes} buffer-copy bytes`);
});

test('fragment validation handles empty frames and UTF-8 split across many continuations', (t) => {
  const { socket } = fixture(t);
  socket.emit('data', frame('', 1, false));
  const empty = frame('', 0, false);
  for (let index = 0; index < 10000; index += 1) socket.emit('data', empty);
  const text = Buffer.from('长时间运行😀');
  for (const byte of text) socket.emit('data', frame(Buffer.from([byte]), 0, false));
  socket.emit('data', frame('', 0));
  assert.equal(socket.destroyed, false);
  assert.equal(socket._wsFragment, null);
  assert.equal(socket._wsFragmentBytes, 0);
});

for (const hours of [12, 24, 168]) {
  test(`WebSocket heartbeat and reconnect resources stay bounded over ${hours} simulated hours`, (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1000 });
    t.mock.method(performance, 'now', () => Date.now());
    const { hub, context, socket: initial } = fixture(t);
    let socket = initial;
    let previousFrames = socket.frames;
    const pong = frame('', 10);
    for (let tick = 1; tick <= hours * 120; tick += 1) {
      t.mock.timers.tick(30000);
      assert.equal(socket.frames, previousFrames + 1, 'one heartbeat per interval');
      socket.emit('data', pong);
      assert.equal(socket.destroyed, false);
      assert.equal(socket.listenerCount('data'), 1);
      assert.equal(context.state.sockets.size, 1);
      if (tick % 120 === 0) {
        socket.destroy();
        assert.equal(socket.listenerCount('data'), 0);
        assert.equal(socket._wsBuffer, null);
        assert.equal(context.state.sockets.size, 0);
        socket = openSocket(hub, context);
      }
      previousFrames = socket.frames;
    }
    hub.stop();
    assert.equal(context.state.sockets.size, 0);
    assert.equal(socket.listenerCount('data'), 0);
    const framesAfterStop = socket.frames;
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    assert.equal(socket.frames, framesAfterStop);
    assert.equal(socket._wsBuffer, null);
  });
}

for (const clockShift of [-7 * 86400000, 86400000]) {
  test(`WebSocket idle expiry ignores a wall-clock shift of ${clockShift}ms`, (t) => {
    let wallNow = 10 * 86400000;
    let elapsed = 0;
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    t.mock.method(Date, 'now', () => wallNow);
    t.mock.method(performance, 'now', () => elapsed);
    const { socket, context } = fixture(t);
    wallNow += clockShift;
    for (let tick = 1; tick <= 4; tick += 1) {
      elapsed += 30000;
      wallNow += 30000;
      t.mock.timers.tick(30000);
      assert.equal(socket.destroyed, tick === 4, 'only elapsed time determines missed-pong expiry');
    }
    assert.equal(context.state.sockets.size, 0);
    assert.equal(socket.listenerCount('data'), 0);
    assert.equal(socket._wsBuffer, null);
  });
}
