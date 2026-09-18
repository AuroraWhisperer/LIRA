'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  WebSocketConnection,
} = require('../src/bilibili/danmaku/websocket-connection');

class FakeWebSocket {
  static OPEN = 1;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeWebSocket.latest = this;
    this.sent = [];
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name, event) {
    for (const listener of this.listeners.get(name) || []) listener(event);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

test('forwards WebSocket error and close event evidence', async () => {
  const originalWebSocket = global.WebSocket;
  const connection = new WebSocketConnection();
  const events = [];
  global.WebSocket = FakeWebSocket;

  try {
    connection.on('error', (event) => events.push({ type: 'error', event }));
    connection.on('close', (event) => events.push({ type: 'close', event }));
    await connection.connect('wss://example.test/sub', {});

    FakeWebSocket.latest.readyState = FakeWebSocket.OPEN;
    FakeWebSocket.latest.emit('error', { message: 'socket failed' });
    FakeWebSocket.latest.emit('close', {
      code: 4001,
      reason: 'risk control',
      wasClean: false,
    });

    assert.deepEqual(events, [
      { type: 'error', event: { message: 'socket failed' } },
      {
        type: 'close',
        event: {
          code: 0,
          reason: 'socket failed',
          wasClean: false,
          connectionError: true,
        },
      },
    ]);
  } finally {
    connection.close();
    global.WebSocket = originalWebSocket;
  }
});

test('closes a half-open connection after a missed Bilibili heartbeat reply', async () => {
  const originalWebSocket = global.WebSocket;
  const connection = new WebSocketConnection({ heartbeatIntervalMs: 8 });
  const closes = [];
  global.WebSocket = FakeWebSocket;

  try {
    connection.on('close', (event) => closes.push(event));
    await connection.connect('wss://example.test/sub', {});
    FakeWebSocket.latest.readyState = FakeWebSocket.OPEN;
    FakeWebSocket.latest.emit('open', {});
    await waitFor(() => closes.length === 1, 200);

    assert.equal(closes.length, 1);
    assert.equal(closes[0].heartbeatTimeout, true);
    assert.equal(connection.ws, null);
  } finally {
    connection.close();
    global.WebSocket = originalWebSocket;
  }
});

test('keeps a connection open when Bilibili answers the heartbeat', async () => {
  const originalWebSocket = global.WebSocket;
  const connection = new WebSocketConnection({ heartbeatIntervalMs: 20 });
  const closes = [];
  global.WebSocket = FakeWebSocket;

  try {
    connection.on('close', (event) => closes.push(event));
    await connection.connect('wss://example.test/sub', {});
    FakeWebSocket.latest.readyState = FakeWebSocket.OPEN;
    FakeWebSocket.latest.emit('open', {});
    await new Promise((resolve) => setTimeout(resolve, 24));
    FakeWebSocket.latest.emit('message', { data: operationPacket(3) });
    await new Promise((resolve) => setTimeout(resolve, 22));

    assert.equal(closes.length, 0);
    assert.notEqual(connection.ws, null);
  } finally {
    connection.close();
    global.WebSocket = originalWebSocket;
  }
});

function operationPacket(operation, body = Buffer.alloc(4)) {
  const packet = Buffer.alloc(16 + body.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(16, 4);
  packet.writeUInt16BE(1, 6);
  packet.writeUInt32BE(operation, 8);
  packet.writeUInt32BE(1, 12);
  body.copy(packet, 16);
  return packet.buffer.slice(
    packet.byteOffset,
    packet.byteOffset + packet.byteLength,
  );
}

test('observes authentication codes in mixed frames without exposing the payload or changing transport state', async (t) => {
  t.mock.property(global, 'WebSocket', FakeWebSocket);
  const connection = new WebSocketConnection();
  t.after(() => connection.close());
  const diagnostics = [];
  const messages = [];
  connection.on('diagnostic', (entry) => diagnostics.push(entry));
  connection.on('message', (data) => messages.push(data));
  await connection.connect('wss://example.test/sub', { key: 'synthetic-token' });
  const socket = FakeWebSocket.latest;
  socket.readyState = FakeWebSocket.OPEN;
  socket.emit('open', {});
  const packet = Buffer.concat([
    Buffer.from(operationPacket(3)),
    Buffer.from(operationPacket(8, Buffer.from(JSON.stringify({ code: -101, token: 'secret-response' })))),
  ]);
  socket.emit('message', { data: packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength) });
  socket.emit('message', { data: operationPacket(8, Buffer.from('{"code":0}')) });
  socket.emit('message', { data: operationPacket(8, Buffer.from('invalid private response')) });
  socket.emit('message', { data: operationPacket(8, Buffer.from('{"code":null}')) });
  assert.deepEqual(diagnostics.filter((entry) => entry.event === 'auth-result'), [
    { event: 'auth-result', status: 'rejected', code: -101 },
    { event: 'auth-result', status: 'accepted', code: 0 },
    { event: 'auth-result', status: 'invalid', code: null },
    { event: 'auth-result', status: 'invalid', code: null },
  ]);
  assert.equal(connection.ws, socket);
  assert.equal(messages.length, 4);
  assert.equal(connection.awaitingHeartbeatReply, false);
  assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-token|secret-response|private response/);
});

test('missing authentication is recorded once and old socket callbacks cannot contaminate a new connection', async (t) => {
  t.mock.property(global, 'WebSocket', FakeWebSocket);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const connection = new WebSocketConnection();
  t.after(() => connection.close());
  const diagnostics = [];
  connection.on('diagnostic', (entry) => diagnostics.push(entry));
  await connection.connect('wss://example.test/sub', {});
  const oldSocket = FakeWebSocket.latest;
  oldSocket.readyState = FakeWebSocket.OPEN;
  oldSocket.emit('open', {});
  t.mock.timers.tick(30000);
  oldSocket.emit('message', { data: operationPacket(3) });
  t.mock.timers.tick(30000);
  assert.equal(diagnostics.filter((entry) => entry.event === 'auth-no-reply').length, 1);
  await connection.connect('wss://example.test/sub', {});
  const newSocket = FakeWebSocket.latest;
  newSocket.readyState = FakeWebSocket.OPEN;
  newSocket.emit('open', {});
  const count = diagnostics.length;
  oldSocket.emit('open', {});
  oldSocket.emit('message', { data: operationPacket(8, Buffer.from('{"code":-101}')) });
  assert.equal(diagnostics.length, count);
  assert.equal(connection.connectionTrace.authStatus, 'pending');
  newSocket.emit('message', { data: operationPacket(8, Buffer.from('{"code":0}')) });
  t.mock.timers.tick(30000);
  assert.equal(diagnostics.filter((entry) => entry.event === 'auth-no-reply').length, 1);
  connection.close();
  const closedCount = diagnostics.length;
  t.mock.timers.tick(90000);
  assert.equal(diagnostics.length, closedCount);
});

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
