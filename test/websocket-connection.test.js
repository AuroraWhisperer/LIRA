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

  close() {}
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

    FakeWebSocket.latest.emit('error', { message: 'socket failed' });
    FakeWebSocket.latest.emit('close', { code: 4001, reason: 'risk control', wasClean: false });

    assert.deepEqual(events, [
      { type: 'error', event: { message: 'socket failed' } },
      { type: 'close', event: { code: 4001, reason: 'risk control', wasClean: false } }
    ]);
  } finally {
    connection.close();
    global.WebSocket = originalWebSocket;
  }
});
