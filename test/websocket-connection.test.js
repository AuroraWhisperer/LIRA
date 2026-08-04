'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WebSocketConnection } = require('../src/bilibili/danmaku/websocket-connection');

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
    FakeWebSocket.latest.emit('close', { code: 4001, reason: 'risk control', wasClean: false });

    assert.deepEqual(events, [
      { type: 'error', event: { message: 'socket failed' } },
      {
        type: 'close',
        event: {
          code: 0,
          reason: 'socket failed',
          wasClean: false,
          connectionError: true
        }
      }
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

function operationPacket(operation) {
  const packet = Buffer.alloc(20);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(16, 4);
  packet.writeUInt16BE(1, 6);
  packet.writeUInt32BE(operation, 8);
  packet.writeUInt32BE(1, 12);
  return packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
